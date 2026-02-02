import { ToolRunnableConfig } from '@langchain/core/tools';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { FilesCodebaseSearchTool } from '../../../v1/agent-tools/tools/common/files/files-codebase-search.tool';
import { BaseAgentConfigurable } from '../../../v1/agents/services/nodes/base-node';
import { LlmModelsService } from '../../../v1/litellm/services/llm-models.service';
import { OpenaiService } from '../../../v1/openai/openai.service';
import { QdrantService } from '../../../v1/qdrant/services/qdrant.service';
import { RuntimeType } from '../../../v1/runtime/runtime.types';
import { BaseRuntime } from '../../../v1/runtime/services/base-runtime';
import { DockerRuntime } from '../../../v1/runtime/services/docker-runtime';
import { RuntimeProvider } from '../../../v1/runtime/services/runtime-provider';
import { RuntimeThreadProvider } from '../../../v1/runtime/services/runtime-thread-provider';
import { createTestModule } from '../setup';

const THREAD_ID = `codebase-search-int-${Date.now()}`;
const RUNNABLE_CONFIG: ToolRunnableConfig<BaseAgentConfigurable> = {
  configurable: {
    thread_id: THREAD_ID,
  },
};
const INT_TEST_TIMEOUT = 120_000;
const VECTOR_SIZE = 3;

const buildEmbedding = (text: string): number[] => {
  const normalized = text.toLowerCase();
  if (normalized.includes('beta-needle')) {
    return [1, 0, 0];
  }
  if (normalized.includes('alpha-needle')) {
    return [0, 1, 0];
  }
  return [0, 0, 1];
};

describe('Codebase search tool (integration)', () => {
  let app: INestApplication;
  let tool: FilesCodebaseSearchTool;
  let qdrantService: QdrantService;
  let runtime: BaseRuntime;
  let runtimeThreadProvider: RuntimeThreadProvider;
  let collectionName: string | null = null;

  const execInRuntime = async (cmd: string) => {
    const res = await runtime.exec({ cmd, cwd: '/runtime-workspace' });
    expect(res.exitCode, `command failed: ${cmd}\n${res.stderr}`).toBe(0);
    return res.stdout.trim();
  };

  const resolveCollectionName = (repoRoot: string) => {
    if (collectionName) {
      return collectionName;
    }
    const repoId = `local:${repoRoot}`;
    const repoSlug = (
      tool as unknown as { slugifyRepoId: (id: string) => string }
    ).slugifyRepoId(repoId);
    const baseName = (
      tool as unknown as { buildCollectionBaseName: (slug: string) => string }
    ).buildCollectionBaseName(repoSlug);
    collectionName = qdrantService.buildSizedCollectionName(
      baseName,
      VECTOR_SIZE,
    );
    return collectionName;
  };

  beforeAll(async () => {
    app = await createTestModule(async (moduleBuilder) =>
      moduleBuilder
        .overrideProvider(OpenaiService)
        .useValue({
          embeddings: async ({ input }: { input: string[] | string }) => {
            const inputs = Array.isArray(input) ? input : [input];
            return {
              embeddings: inputs.map(buildEmbedding),
            };
          },
        })
        .overrideProvider(LlmModelsService)
        .useValue({
          getKnowledgeEmbeddingModel: () => 'test-embedding',
        })
        .compile(),
    );

    tool = await app.resolve(FilesCodebaseSearchTool);
    qdrantService = app.get(QdrantService);

    runtime = new DockerRuntime({ socketPath: environment.dockerSocket });
    await runtime.start({
      image: environment.dockerRuntimeImage,
      recreate: true,
      containerName: `codebase-search-${Date.now()}`,
    });

    runtimeThreadProvider = new RuntimeThreadProvider(
      {
        provide: async () => ({ runtime, created: false }),
      } as unknown as RuntimeProvider,
      {
        graphId: `graph-${Date.now()}`,
        runtimeNodeId: `runtime-${Date.now()}`,
        type: RuntimeType.Docker,
        runtimeStartParams: {
          image: environment.dockerRuntimeImage,
        },
        temporary: true,
      },
    );

    const gitCheck = await runtime.exec({
      cmd: 'git --version',
      cwd: '/runtime-workspace',
    });
    expect(gitCheck.exitCode).toBe(0);
  }, INT_TEST_TIMEOUT);

  afterAll(async () => {
    if (collectionName) {
      const collections = await qdrantService.raw.getCollections();
      const exists = collections.collections.some(
        (collection) => collection.name === collectionName,
      );
      if (exists) {
        await qdrantService.raw.deleteCollection(collectionName);
      }
    }

    if (runtime) {
      await runtime.stop().catch(() => undefined);
    }

    await app?.close();
  }, INT_TEST_TIMEOUT);

  it(
    'indexes repo contents and updates index on commit change',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const alphaToken = `alpha-needle-${randomUUID()}`;
      const betaToken = `beta-needle-${randomUUID()}`;

      await execInRuntime(
        'rm -rf /runtime-workspace/.git /runtime-workspace/src',
      );
      await execInRuntime('mkdir -p /runtime-workspace/src');
      await execInRuntime(
        `cat <<'EOF' > /runtime-workspace/src/app.ts
export const handler = () => {
  return "${alphaToken}";
};
EOF`,
      );
      await execInRuntime('git init -b main');
      await execInRuntime('git config user.email "test@example.com"');
      await execInRuntime('git config user.name "Test User"');
      await execInRuntime('git add .');
      await execInRuntime('git commit -m "init"');

      const repoRoot = '/runtime-workspace';
      const collection = resolveCollectionName(repoRoot);

      const initial = await tool.invoke(
        { query: alphaToken, top_k: 5 },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      const initialMatches = initial.output.results ?? [];
      expect(initialMatches.length).toBeGreaterThan(0);
      expect(
        initialMatches.some((match) => match.text.includes(alphaToken)),
      ).toBe(true);

      const initialCommit = await execInRuntime('git rev-parse HEAD');
      const statePointId = (
        tool as unknown as { buildStatePointId: (repoId: string) => string }
      ).buildStatePointId(`local:${repoRoot}`);
      const initialState = await qdrantService.retrievePoints(collection, {
        ids: [statePointId],
        with_payload: true,
      });
      expect(initialState[0]?.payload?.last_indexed_commit).toBe(initialCommit);

      await execInRuntime(
        `cat <<'EOF' > /runtime-workspace/src/app.ts
export const handler = () => {
  return "${betaToken}";
};
EOF`,
      );
      await execInRuntime('git add .');
      await execInRuntime('git commit -m "update"');

      const updated = await tool.invoke(
        { query: betaToken, top_k: 5 },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      const updatedMatches = updated.output.results ?? [];
      expect(updatedMatches.length).toBeGreaterThan(0);
      expect(
        updatedMatches.some((match) => match.text.includes(betaToken)),
      ).toBe(true);

      const alphaSearch = await tool.invoke(
        { query: alphaToken, top_k: 5 },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      const alphaMatches = alphaSearch.output.results ?? [];
      expect(
        alphaMatches.some((match) => match.text.includes(alphaToken)),
      ).toBe(false);

      const updatedCommit = await execInRuntime('git rev-parse HEAD');
      const updatedState = await qdrantService.retrievePoints(collection, {
        ids: [statePointId],
        with_payload: true,
      });
      expect(updatedState[0]?.payload?.last_indexed_commit).toBe(updatedCommit);

      const points = await qdrantService.scrollAll(collection, {
        filter: {
          must: [
            { key: 'repo_id', match: { value: `local:${repoRoot}` } },
            { key: 'path', match: { value: 'src/app.ts' } },
          ],
        },
        limit: 50,
        with_payload: true,
      } as Parameters<QdrantService['scrollAll']>[1]);
      expect(
        points.some((point) =>
          String(point.payload?.text ?? '').includes(alphaToken),
        ),
      ).toBe(false);
    },
  );
});
