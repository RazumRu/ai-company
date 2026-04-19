import { MikroORM } from '@mikro-orm/postgresql';
import { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { ProjectsDao } from '../../../v1/projects/dao/projects.dao';
import { ThreadStoreDao } from '../../../v1/thread-store/dao/thread-store.dao';
import { ThreadStoreService } from '../../../v1/thread-store/services/thread-store.service';
import { ThreadStoreEntryMode } from '../../../v1/thread-store/thread-store.types';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { createTestProject } from '../helpers/test-context';
import { createTestModule } from '../setup';

let contextDataStorage: AppContextStorage;

describe('ThreadStoreService (integration)', () => {
  let app: INestApplication;
  let threadStoreService: ThreadStoreService;
  let threadStoreDao: ThreadStoreDao;
  let threadsDao: ThreadsDao;
  let mikroOrm: MikroORM;
  let testProjectId: string;
  const createdThreadIds: string[] = [];
  const createdGraphIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    threadStoreService = app.get(ThreadStoreService);
    threadStoreDao = app.get(ThreadStoreDao);
    threadsDao = app.get(ThreadsDao);
    mikroOrm = app.get(MikroORM);

    const schemaGenerator = (
      mikroOrm as unknown as {
        getSchemaGenerator(): { updateSchema(): Promise<void> };
      }
    ).getSchemaGenerator();
    await schemaGenerator.updateSchema();

    const projectResult = await createTestProject(app);
    testProjectId = projectResult.projectId;
    contextDataStorage = projectResult.ctx;
  }, 120_000);

  afterEach(async () => {
    for (const id of createdThreadIds) {
      // Hard-delete to drop thread-store entries via cascade.
      await threadsDao.hardDeleteById(id);
    }
    createdThreadIds.length = 0;
  });

  afterAll(async () => {
    if (testProjectId) {
      try {
        await app.get(ProjectsDao).deleteById(testProjectId);
      } catch {
        // best effort cleanup
      }
    }

    await app?.close();
  });

  const createTestThread = async () => {
    const em = mikroOrm.em.fork();
    const userId = contextDataStorage.checkSub();

    // A minimal graph record so the thread has a graphId to point at.
    const graphId = `graph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await em.getConnection().execute(
      `insert into "graphs" ("id", "created_by", "project_id", "name", "status", "schema", "created_at", "updated_at")
       values (?, ?, ?, ?, ?, ?::jsonb, now(), now())`,
      [
        graphId,
        userId,
        testProjectId,
        `Thread Store Test Graph ${Date.now()}`,
        GraphStatus.Created,
        JSON.stringify({ nodes: [], edges: [] }),
      ],
    );
    createdGraphIds.push(graphId);

    const externalThreadId = `${graphId}:${Date.now()}`;
    const thread = await threadsDao.create({
      graphId,
      createdBy: userId,
      projectId: testProjectId,
      externalThreadId,
      status: ThreadStatus.Running,
    });

    createdThreadIds.push(thread.id);
    return thread;
  };

  it(
    'round-trip: put, append, get, list, delete across parent + subagent perspective',
    { timeout: 60_000 },
    async () => {
      const thread = await createTestThread();

      // Root agent writes a KV plan.
      const plan = await threadStoreService.put(contextDataStorage, thread.id, {
        namespace: 'plan',
        key: 'root',
        value: { goal: 'refactor auth', steps: ['audit', 'rename'] },
        authorAgentId: 'root',
        tags: ['plan'],
      });
      expect(plan.mode).toBe(ThreadStoreEntryMode.Kv);

      // Subagent appends a learning via `*ForUser` entry point (simulating
      // a tool invocation where ctx isn't available).
      const userId = contextDataStorage.checkSub();
      const learning = await threadStoreService.appendForUser(
        userId,
        thread.id,
        {
          namespace: 'learnings',
          value: 'auth middleware also runs on WebSocket upgrades',
          authorAgentId: 'system:explorer',
          tags: ['auth'],
        },
      );
      expect(learning.mode).toBe(ThreadStoreEntryMode.Append);
      expect(learning.authorAgentId).toBe('system:explorer');

      // Resolving external -> internal thread id works for subagents.
      const resolvedInternalId =
        await threadStoreService.resolveInternalThreadId(
          userId,
          thread.externalThreadId,
        );
      expect(resolvedInternalId).toBe(thread.id);

      // Parent can read the subagent's learning via get.
      const fetchedLearning = await threadStoreService.get(
        contextDataStorage,
        thread.id,
        'learnings',
        learning.key,
      );
      expect(fetchedLearning?.value).toBe(
        'auth middleware also runs on WebSocket upgrades',
      );

      // Namespaces summary reflects both writes.
      const summaries = await threadStoreService.listNamespaces(
        contextDataStorage,
        thread.id,
      );
      const names = summaries.map((s) => s.namespace).sort();
      expect(names).toEqual(['learnings', 'plan']);

      // List entries in the plan namespace returns the single KV entry.
      const planEntries = await threadStoreService.listEntries(
        contextDataStorage,
        thread.id,
        'plan',
      );
      expect(planEntries).toHaveLength(1);
      expect(planEntries[0]!.key).toBe('root');

      // Deleting a KV entry works.
      await threadStoreService.delete(
        contextDataStorage,
        thread.id,
        'plan',
        'root',
      );
      const afterDelete = await threadStoreService.get(
        contextDataStorage,
        thread.id,
        'plan',
        'root',
      );
      expect(afterDelete).toBeNull();

      // Append entries remain.
      const learnings = await threadStoreService.listEntries(
        contextDataStorage,
        thread.id,
        'learnings',
      );
      expect(learnings).toHaveLength(1);
    },
  );

  it(
    'rejects deletion of append-only entries',
    { timeout: 30_000 },
    async () => {
      const thread = await createTestThread();
      const appended = await threadStoreService.append(
        contextDataStorage,
        thread.id,
        {
          namespace: 'reports',
          value: 'first report',
        },
      );

      await expect(
        threadStoreService.delete(
          contextDataStorage,
          thread.id,
          'reports',
          appended.key,
        ),
      ).rejects.toMatchObject({ code: 'THREAD_STORE_APPEND_IMMUTABLE' });

      // Entry is still there.
      const still = await threadStoreService.get(
        contextDataStorage,
        thread.id,
        'reports',
        appended.key,
      );
      expect(still).not.toBeNull();
    },
  );

  it('isolates stores across threads', { timeout: 30_000 }, async () => {
    const threadA = await createTestThread();
    const threadB = await createTestThread();

    await threadStoreService.put(contextDataStorage, threadA.id, {
      namespace: 'plan',
      key: 'root',
      value: 'thread-a-plan',
    });

    const crossRead = await threadStoreService.get(
      contextDataStorage,
      threadB.id,
      'plan',
      'root',
    );
    expect(crossRead).toBeNull();
  });

  it(
    'surfaces entries via direct DAO lookup',
    { timeout: 10_000 },
    async () => {
      const thread = await createTestThread();
      await threadStoreService.put(contextDataStorage, thread.id, {
        namespace: 'todo',
        key: 'write-docs',
        value: { status: 'pending' },
      });

      const entry = await threadStoreDao.getByKey(
        thread.id,
        'todo',
        'write-docs',
      );
      expect(entry).not.toBeNull();
      expect(entry!.mode).toBe(ThreadStoreEntryMode.Kv);
    },
  );
});
