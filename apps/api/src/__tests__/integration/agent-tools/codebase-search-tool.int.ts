import { ToolRunnableConfig } from '@langchain/core/tools';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { FilesCodebaseSearchTool } from '../../../v1/agent-tools/tools/common/files/files-codebase-search.tool';
import { BaseAgentConfigurable } from '../../../v1/agents/services/nodes/base-node';
import { RepoIndexService } from '../../../v1/git-repositories/services/repo-index.service';
import { RepoIndexerService } from '../../../v1/git-repositories/services/repo-indexer.service';
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
  let repoIndexerService: RepoIndexerService;
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
    const repositoryId = uuidv5(repoId, environment.codebaseUuidNamespace);
    const repoSlug = repoIndexerService.deriveRepoSlug(repositoryId);
    collectionName = repoIndexerService.buildCollectionName(
      repoSlug,
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
    repoIndexerService = app.get(RepoIndexerService);

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
        { query: alphaToken, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      const initialMatches = initial.output.results ?? [];
      expect(initialMatches.length).toBeGreaterThan(0);
      expect(
        initialMatches.some((match) => match.text.includes(alphaToken)),
      ).toBe(true);

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
        { query: betaToken, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      const updatedMatches = updated.output.results ?? [];
      expect(updatedMatches.length).toBeGreaterThan(0);
      expect(
        updatedMatches.some((match) => match.text.includes(betaToken)),
      ).toBe(true);

      const alphaSearch = await tool.invoke(
        { query: alphaToken, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      const alphaMatches = alphaSearch.output.results ?? [];
      expect(
        alphaMatches.some((match) => match.text.includes(alphaToken)),
      ).toBe(false);

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

  it(
    'handles multiple files and file deletions correctly',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const fileAToken = `alpha-needle-${randomUUID()}`;
      const fileBToken = `beta-needle-${randomUUID()}`;

      await execInRuntime(
        'rm -rf /runtime-workspace/.git /runtime-workspace/src',
      );
      await execInRuntime('mkdir -p /runtime-workspace/src/utils');
      await execInRuntime(
        `cat <<'EOF' > /runtime-workspace/src/fileA.ts
export const funcA = () => {
  return "${fileAToken}";
};
EOF`,
      );
      await execInRuntime(
        `cat <<'EOF' > /runtime-workspace/src/fileB.ts
export const funcB = () => {
  return "${fileBToken}";
};
EOF`,
      );
      await execInRuntime('git init -b main');
      await execInRuntime('git config user.email "test@example.com"');
      await execInRuntime('git config user.name "Test User"');
      await execInRuntime('git add .');
      await execInRuntime('git commit -m "add two files"');

      const repoRoot = '/runtime-workspace';

      const searchA = await tool.invoke(
        { query: fileAToken, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(searchA.output.results?.length).toBeGreaterThan(0);
      expect(
        searchA.output.results?.some((m) => m.text.includes(fileAToken)),
      ).toBe(true);

      const searchB = await tool.invoke(
        { query: fileBToken, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(searchB.output.results?.length).toBeGreaterThan(0);
      expect(
        searchB.output.results?.some((m) => m.text.includes(fileBToken)),
      ).toBe(true);

      await execInRuntime('rm /runtime-workspace/src/fileA.ts');
      await execInRuntime('git add .');
      await execInRuntime('git commit -m "delete fileA"');

      const afterDelete = await tool.invoke(
        { query: fileAToken, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        afterDelete.output.results?.some((m) => m.text.includes(fileAToken)),
      ).toBe(false);

      const searchBAfterDelete = await tool.invoke(
        { query: fileBToken, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(searchBAfterDelete.output.results?.length).toBeGreaterThan(0);
      expect(
        searchBAfterDelete.output.results?.some((m) =>
          m.text.includes(fileBToken),
        ),
      ).toBe(true);
    },
  );

  it(
    'respects directory filter when searching',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const rootToken = `alpha-needle-${randomUUID()}`;
      const utilsToken = `beta-needle-${randomUUID()}`;

      await execInRuntime(
        'rm -rf /runtime-workspace/.git /runtime-workspace/src',
      );
      await execInRuntime('mkdir -p /runtime-workspace/src/utils');
      await execInRuntime(
        `cat <<'EOF' > /runtime-workspace/src/root.ts
export const rootFunc = () => {
  return "${rootToken}";
};
EOF`,
      );
      await execInRuntime(
        `cat <<'EOF' > /runtime-workspace/src/utils/helper.ts
export const helperFunc = () => {
  return "${utilsToken}";
};
EOF`,
      );
      await execInRuntime('git init -b main');
      await execInRuntime('git config user.email "test@example.com"');
      await execInRuntime('git config user.name "Test User"');
      await execInRuntime('git add .');
      await execInRuntime('git commit -m "add root and utils files"');

      const repoRoot = '/runtime-workspace';

      const searchRoot = await tool.invoke(
        { query: rootToken, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        searchRoot.output.results?.some((m) => m.text.includes(rootToken)),
      ).toBe(true);

      const searchUtils = await tool.invoke(
        { query: utilsToken, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        searchUtils.output.results?.some((m) => m.text.includes(utilsToken)),
      ).toBe(true);

      const searchUtilsFiltered = await tool.invoke(
        {
          query: utilsToken,
          top_k: 5,
          directory: `${repoRoot}/src/utils`,
        },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        searchUtilsFiltered.output.results?.some((m) =>
          m.text.includes(utilsToken),
        ),
      ).toBe(true);
      expect(
        searchUtilsFiltered.output.results?.every((m) =>
          m.path.includes('utils'),
        ),
      ).toBe(true);

      const searchRootFiltered = await tool.invoke(
        {
          query: rootToken,
          top_k: 5,
          directory: `${repoRoot}/src/utils`,
        },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        searchRootFiltered.output.results?.some((m) =>
          m.text.includes(rootToken),
        ),
      ).toBe(false);
    },
  );

  it(
    'respects language filter when searching',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const tsToken = `alpha-needle-${randomUUID()}`;
      const pyToken = `beta-needle-${randomUUID()}`;

      await execInRuntime(
        'rm -rf /runtime-workspace/.git /runtime-workspace/src',
      );
      await execInRuntime('mkdir -p /runtime-workspace/src');
      await execInRuntime(
        `cat <<'EOF' > /runtime-workspace/src/app.ts
export const handler = () => {
  return "${tsToken}";
};
EOF`,
      );
      await execInRuntime(
        `cat <<'EOF' > /runtime-workspace/src/script.py
def main():
    return "${pyToken}"
EOF`,
      );
      await execInRuntime('git init -b main');
      await execInRuntime('git config user.email "test@example.com"');
      await execInRuntime('git config user.name "Test User"');
      await execInRuntime('git add .');
      await execInRuntime('git commit -m "add ts and py files"');

      const repoRoot = '/runtime-workspace';

      const searchAll = await tool.invoke(
        { query: tsToken, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        searchAll.output.results?.some((m) => m.text.includes(tsToken)),
      ).toBe(true);

      const searchTsFiltered = await tool.invoke(
        { query: tsToken, top_k: 5, directory: repoRoot, language: 'ts' },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        searchTsFiltered.output.results?.some((m) => m.text.includes(tsToken)),
      ).toBe(true);
      expect(
        searchTsFiltered.output.results?.every((m) => m.path.endsWith('.ts')),
      ).toBe(true);

      const searchPyFiltered = await tool.invoke(
        { query: pyToken, top_k: 5, directory: repoRoot, language: 'py' },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        searchPyFiltered.output.results?.some((m) => m.text.includes(pyToken)),
      ).toBe(true);
      expect(
        searchPyFiltered.output.results?.every((m) => m.path.endsWith('.py')),
      ).toBe(true);

      const searchWrongLanguage = await tool.invoke(
        { query: tsToken, top_k: 5, directory: repoRoot, language: 'py' },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        searchWrongLanguage.output.results?.some((m) =>
          m.text.includes(tsToken),
        ),
      ).toBe(false);
    },
  );

  it(
    'handles file modifications without hash changes (same content)',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const token = `alpha-needle-${randomUUID()}`;

      await execInRuntime(
        'rm -rf /runtime-workspace/.git /runtime-workspace/src',
      );
      await execInRuntime('mkdir -p /runtime-workspace/src');
      await execInRuntime(
        `cat <<'EOF' > /runtime-workspace/src/app.ts
export const handler = () => {
  return "${token}";
};
EOF`,
      );
      await execInRuntime('git init -b main');
      await execInRuntime('git config user.email "test@example.com"');
      await execInRuntime('git config user.name "Test User"');
      await execInRuntime('git add .');
      await execInRuntime('git commit -m "initial"');

      const repoRoot = '/runtime-workspace';

      const firstSearch = await tool.invoke(
        { query: token, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        firstSearch.output.results?.some((m) => m.text.includes(token)),
      ).toBe(true);

      await execInRuntime('touch /runtime-workspace/src/app.ts');
      await execInRuntime('git add .');
      await execInRuntime('git commit -m "touch file" --allow-empty');

      const secondSearch = await tool.invoke(
        { query: token, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        secondSearch.output.results?.some((m) => m.text.includes(token)),
      ).toBe(true);
    },
  );

  it(
    'handles adding new files to existing index',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const file1Token = `alpha-needle-${randomUUID()}`;
      const file2Token = `beta-needle-${randomUUID()}`;

      await execInRuntime(
        'rm -rf /runtime-workspace/.git /runtime-workspace/src',
      );
      await execInRuntime('mkdir -p /runtime-workspace/src');
      await execInRuntime(
        `cat <<'EOF' > /runtime-workspace/src/file1.ts
export const func1 = () => {
  return "${file1Token}";
};
EOF`,
      );
      await execInRuntime('git init -b main');
      await execInRuntime('git config user.email "test@example.com"');
      await execInRuntime('git config user.name "Test User"');
      await execInRuntime('git add .');
      await execInRuntime('git commit -m "add file1"');

      const repoRoot = '/runtime-workspace';

      const search1 = await tool.invoke(
        { query: file1Token, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        search1.output.results?.some((m) => m.text.includes(file1Token)),
      ).toBe(true);

      await execInRuntime(
        `cat <<'EOF' > /runtime-workspace/src/file2.ts
export const func2 = () => {
  return "${file2Token}";
};
EOF`,
      );
      await execInRuntime('git add .');
      await execInRuntime('git commit -m "add file2"');

      const search2 = await tool.invoke(
        { query: file2Token, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        search2.output.results?.some((m) => m.text.includes(file2Token)),
      ).toBe(true);

      const search1Again = await tool.invoke(
        { query: file1Token, top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(
        search1Again.output.results?.some((m) => m.text.includes(file1Token)),
      ).toBe(true);
    },
  );

  it(
    'returns error when directory is not a git repository',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      await execInRuntime('rm -rf /runtime-workspace/.git');
      await execInRuntime('mkdir -p /runtime-workspace/src');
      await execInRuntime('echo "content" > /runtime-workspace/src/file.txt');

      const repoRoot = '/runtime-workspace';

      const result = await tool.invoke(
        { query: 'test query', top_k: 5, directory: repoRoot },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(result.output.error).toBeDefined();
      expect(result.output.error).toContain('git repository');
    },
  );
});
