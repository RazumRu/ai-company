import { PassThrough } from 'stream';

import { INestApplication } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { GraphDao } from '../../../v1/graphs/dao/graph.dao';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { MessageRole } from '../../../v1/graphs/graphs.types';
import { ProjectsDao } from '../../../v1/projects/dao/projects.dao';
import { MessagesDao } from '../../../v1/threads/dao/messages.dao';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { buildTestContext } from '../helpers/test-context';
import { createTestModule, TEST_USER_ID } from '../setup';

function collectStream(stream: PassThrough): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
}

describe('Thread Export Integration Tests', () => {
  let app: INestApplication;
  let threadsService: ThreadsService;
  let graphDao: GraphDao;
  let threadsDao: ThreadsDao;
  let messagesDao: MessagesDao;
  let projectsDao: ProjectsDao;

  let testProjectId: string;
  let ctx: AppContextStorage;

  const createdGraphIds: string[] = [];
  const createdThreadIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();

    threadsService = app.get<ThreadsService>(ThreadsService);
    graphDao = app.get<GraphDao>(GraphDao);
    threadsDao = app.get<ThreadsDao>(ThreadsDao);
    messagesDao = app.get<MessagesDao>(MessagesDao);
    projectsDao = app.get<ProjectsDao>(ProjectsDao);

    const project = await projectsDao.create({
      name: `Thread Export Test Project ${Date.now()}`,
      description: null,
      icon: null,
      color: null,
      settings: {},
      createdBy: TEST_USER_ID,
    });
    testProjectId = project.id;
    ctx = buildTestContext(TEST_USER_ID, testProjectId);
  });

  afterEach(async () => {
    for (const threadId of createdThreadIds) {
      await messagesDao.delete({ threadId });
      await threadsDao.deleteById(threadId);
    }
    createdThreadIds.length = 0;

    for (const graphId of createdGraphIds) {
      await graphDao.deleteById(graphId);
    }
    createdGraphIds.length = 0;
  });

  afterAll(async () => {
    await projectsDao.deleteById(testProjectId);
    await app.close();
  });

  it('happy path — exports thread with messages and graph snapshot', async () => {
    const graph = await graphDao.create({
      name: 'Export Test Graph',
      description: 'Graph for export test',
      error: null,
      version: '1.0.0',
      targetVersion: '1.0.0',
      schema: {
        nodes: [{ id: 'agent-1', template: 'simple-agent', config: {} }],
        edges: [],
      },
      status: GraphStatus.Created,
      metadata: {},
      createdBy: TEST_USER_ID,
      projectId: testProjectId,
      temporary: true,
    });
    createdGraphIds.push(graph.id);

    const thread = await threadsDao.create({
      graphId: graph.id,
      createdBy: TEST_USER_ID,
      projectId: testProjectId,
      externalThreadId: `export-test-${Date.now()}`,
      metadata: {},
      source: null,
      name: 'Export Test Thread',
      status: ThreadStatus.Done,
    });
    createdThreadIds.push(thread.id);

    await messagesDao.create({
      threadId: thread.id,
      externalThreadId: thread.externalThreadId,
      nodeId: 'agent-1',
      message: { role: MessageRole.Human, content: 'Hello' },
      role: MessageRole.Human,
    });
    await messagesDao.create({
      threadId: thread.id,
      externalThreadId: thread.externalThreadId,
      nodeId: 'agent-1',
      message: { role: MessageRole.AI, content: 'Hello back' },
      role: MessageRole.AI,
    });
    await messagesDao.create({
      threadId: thread.id,
      externalThreadId: thread.externalThreadId,
      nodeId: 'agent-1',
      message: { role: MessageRole.Human, content: 'Thanks' },
      role: MessageRole.Human,
    });

    const stream = new PassThrough();
    const outputPromise = collectStream(stream);
    await (threadsService as any).streamThreadExport(ctx, thread, stream);
    const raw = await outputPromise;

    const exported = JSON.parse(raw);

    expect(exported.version).toBe('1');
    expect(exported.isRunning).toBe(false);
    expect(exported.exportedAt).toBeDefined();
    expect(typeof exported.exportedAt).toBe('string');

    expect(exported.thread).toBeDefined();
    expect(exported.thread.id).toBe(thread.id);
    expect(exported.thread.name).toBe('Export Test Thread');

    expect(exported.messages).toHaveLength(3);
    const roles = exported.messages.map((m: { message: { role: string } }) => m.message.role);
    expect(roles).toContain(MessageRole.Human);
    expect(roles).toContain(MessageRole.AI);

    expect(exported.graph).not.toBeNull();
    expect(exported.graph.id).toBe(graph.id);
    expect(exported.graph.name).toBe('Export Test Graph');
    expect(exported.graph.nodes).toHaveLength(1);

    expect(exported.usageStatistics).toBeDefined();
    expect(typeof exported.usageStatistics.requests).toBe('number');
    expect(exported.usageStatistics.total).toBeDefined();
  });

  it('sets isRunning: true for a running thread', async () => {
    const graph = await graphDao.create({
      name: 'Running Thread Export Graph',
      description: null,
      error: null,
      version: '1.0.0',
      targetVersion: '1.0.0',
      schema: { nodes: [], edges: [] },
      status: GraphStatus.Running,
      metadata: {},
      createdBy: TEST_USER_ID,
      projectId: testProjectId,
      temporary: true,
    });
    createdGraphIds.push(graph.id);

    const thread = await threadsDao.create({
      graphId: graph.id,
      createdBy: TEST_USER_ID,
      projectId: testProjectId,
      externalThreadId: `running-export-${Date.now()}`,
      metadata: {},
      source: null,
      name: null,
      status: ThreadStatus.Running,
    });
    createdThreadIds.push(thread.id);

    const stream = new PassThrough();
    const outputPromise = collectStream(stream);
    await (threadsService as any).streamThreadExport(ctx, thread, stream);
    const raw = await outputPromise;

    const exported = JSON.parse(raw);
    expect(exported.isRunning).toBe(true);
    expect(exported.messages).toHaveLength(0);
  });

  it('sets graph: null when graph is soft-deleted', async () => {
    // Create a graph, then soft-delete it.
    // Soft-delete keeps the row for FK integrity (thread still exists),
    // but getSchemaAndMetadata excludes soft-deleted rows → returns empty map → graph: null.
    const graph = await graphDao.create({
      name: 'Soft-Deleted Graph For Export',
      description: null,
      error: null,
      version: '1.0.0',
      targetVersion: '1.0.0',
      schema: { nodes: [], edges: [] },
      status: GraphStatus.Created,
      metadata: {},
      createdBy: TEST_USER_ID,
      projectId: testProjectId,
      temporary: true,
    });
    createdGraphIds.push(graph.id);

    const thread = await threadsDao.create({
      graphId: graph.id,
      createdBy: TEST_USER_ID,
      projectId: testProjectId,
      externalThreadId: `deleted-graph-export-${Date.now()}`,
      metadata: {},
      source: null,
      name: null,
      status: ThreadStatus.Done,
    });
    createdThreadIds.push(thread.id);

    // Soft-delete the graph — preserves FK, but removes it from standard queries
    await graphDao.deleteById(graph.id);

    const stream = new PassThrough();
    const outputPromise = collectStream(stream);
    await (threadsService as any).streamThreadExport(ctx, thread, stream);
    const raw = await outputPromise;

    const exported = JSON.parse(raw);
    expect(exported.graph).toBeNull();
    expect(exported.messages).toHaveLength(0);
  });

  it('getThreadExportFile throws NotFoundException for a different user', async () => {
    const graph = await graphDao.create({
      name: 'Validate Access Graph',
      description: null,
      error: null,
      version: '1.0.0',
      targetVersion: '1.0.0',
      schema: { nodes: [], edges: [] },
      status: GraphStatus.Created,
      metadata: {},
      createdBy: TEST_USER_ID,
      projectId: testProjectId,
      temporary: true,
    });
    createdGraphIds.push(graph.id);

    const thread = await threadsDao.create({
      graphId: graph.id,
      createdBy: TEST_USER_ID,
      projectId: testProjectId,
      externalThreadId: `validate-access-${Date.now()}`,
      metadata: {},
      source: null,
      name: null,
      status: ThreadStatus.Done,
    });
    createdThreadIds.push(thread.id);

    const otherUserCtx = buildTestContext(
      '00000000-0000-0000-0000-000000009999',
    );

    await expect(
      threadsService.getThreadExportFile(otherUserCtx, thread.id),
    ).rejects.toThrow(NotFoundException);

    // Correct user should resolve to a StreamableFile
    await expect(
      threadsService.getThreadExportFile(ctx, thread.id),
    ).resolves.toBeDefined();
  });
});
