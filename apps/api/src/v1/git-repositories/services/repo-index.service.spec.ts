import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';
import { QdrantService } from '../../qdrant/services/qdrant.service';
import { RuntimeInstanceDao } from '../../runtime/dao/runtime-instance.dao';
import { RuntimeProvider } from '../../runtime/services/runtime-provider';
import { GitRepositoriesDao } from '../dao/git-repositories.dao';
import { RepoIndexDao } from '../dao/repo-index.dao';
import { RepoIndexEntity } from '../entity/repo-index.entity';
import { RepoIndexStatus } from '../git-repositories.types';
import { GitRepositoriesService } from './git-repositories.service';
import { RepoIndexService } from './repo-index.service';
import { RepoIndexQueueService } from './repo-index-queue.service';
import { RepoExecFn, RepoIndexerService } from './repo-indexer.service';

vi.mock('../../../environments', () => ({
  environment: {
    codebaseIndexTokenThreshold: 30000,
    codebaseUuidNamespace: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
    credentialEncryptionKey: 'a'.repeat(64),
  },
}));

const mockRepoIndexDao = {
  getOne: vi.fn(),
  getAll: vi.fn().mockResolvedValue([]), // For recoverStuckJobs
  create: vi.fn(),
  updateById: vi.fn(),
  incrementIndexedTokens: vi.fn().mockResolvedValue(undefined),
  withIndexLock: vi
    .fn()
    .mockImplementation(
      (_repoId: string, _branch: string, cb: () => Promise<unknown>) => cb(),
    ),
};

const mockGitRepositoriesDao = {
  getOne: vi.fn(),
};

const mockGitRepositoriesService = {
  encryptCredential: vi.fn((text: string) => `encrypted:${text}`),
  decryptCredential: vi.fn((text: string) => text.replace('encrypted:', '')),
};

const mockRepoIndexerService = {
  estimateTokenCount: vi.fn().mockResolvedValue(100),
  estimateChangedTokenCount: vi.fn().mockResolvedValue(100),
  resolveCurrentCommit: vi.fn().mockResolvedValue('abc123'),
  getCurrentBranch: vi.fn().mockResolvedValue('main'),
  getVectorSizeForModel: vi.fn().mockResolvedValue(1536),
  getChunkingSignatureHash: vi.fn().mockReturnValue('sig-hash-123'),
  deriveRepoId: vi.fn((url: string) => url),
  deriveRepoSlug: vi.fn().mockReturnValue('my_repo'),
  buildCollectionName: vi.fn().mockReturnValue('codebase_my_repo_main_1536'),
  calculateIndexMetadata: vi.fn().mockResolvedValue({
    embeddingModel: 'text-embedding-3-small',
    vectorSize: 1536,
    chunkingSignatureHash: 'sig-hash-123',
    repoSlug: 'my_repo',
    collection: 'codebase_my_repo_main_1536',
  }),
  copyCollectionPoints: vi.fn().mockResolvedValue(0),
  runFullIndex: vi.fn().mockResolvedValue(undefined),
  runIncrementalIndex: vi.fn().mockResolvedValue(undefined),
  buildRepoFilter: vi.fn().mockImplementation((repoId: string) => ({
    must: [{ key: 'repo_id', match: { value: repoId } }],
  })),
};

const mockRepoIndexQueueService = {
  setCallbacks: vi.fn(),
  addIndexJob: vi.fn().mockResolvedValue(undefined),
};

const mockLlmModelsService = {
  getKnowledgeEmbeddingModel: vi.fn(() => 'text-embedding-3-small'),
};

const mockOpenaiService = {};
const mockQdrantService = {};
const mockRuntimeProvider = {};
const mockRuntimeInstanceDao = {
  getOne: vi.fn(),
  updateById: vi.fn(),
};

const mockLogger = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

const execFn: RepoExecFn = vi.fn().mockResolvedValue({
  exitCode: 0,
  stdout: '',
  stderr: '',
});

describe('RepoIndexService', () => {
  let service: RepoIndexService;

  beforeEach(async () => {
    vi.resetAllMocks();
    // Restore default mock implementations after reset
    mockRepoIndexDao.getAll.mockResolvedValue([]);
    mockRepoIndexDao.incrementIndexedTokens.mockResolvedValue(undefined);
    mockRepoIndexDao.withIndexLock.mockImplementation(
      (_repoId: string, _branch: string, cb: () => Promise<unknown>) => cb(),
    );
    mockRepoIndexerService.estimateTokenCount.mockResolvedValue(100);
    mockRepoIndexerService.estimateChangedTokenCount.mockResolvedValue(100);
    mockRepoIndexerService.resolveCurrentCommit.mockResolvedValue('abc123');
    mockRepoIndexerService.getCurrentBranch.mockResolvedValue('main');
    mockRepoIndexerService.getVectorSizeForModel.mockResolvedValue(1536);
    mockRepoIndexerService.getChunkingSignatureHash.mockReturnValue(
      'sig-hash-123',
    );
    mockRepoIndexerService.deriveRepoId.mockImplementation(
      (url: string) => url,
    );
    mockRepoIndexerService.deriveRepoSlug.mockReturnValue('my_repo');
    mockRepoIndexerService.buildCollectionName.mockReturnValue(
      'codebase_my_repo_main_1536',
    );
    mockRepoIndexerService.calculateIndexMetadata.mockResolvedValue({
      embeddingModel: 'text-embedding-3-small',
      vectorSize: 1536,
      chunkingSignatureHash: 'sig-hash-123',
      repoSlug: 'my_repo',
      collection: 'codebase_my_repo_main_1536',
    });
    mockRepoIndexerService.copyCollectionPoints.mockResolvedValue(0);
    mockRepoIndexerService.runFullIndex.mockResolvedValue(undefined);
    mockRepoIndexerService.runIncrementalIndex.mockResolvedValue(undefined);
    mockRepoIndexerService.buildRepoFilter.mockImplementation(
      (repoId: string) => ({
        must: [{ key: 'repo_id', match: { value: repoId } }],
      }),
    );
    mockRepoIndexQueueService.addIndexJob.mockResolvedValue(undefined);
    mockLlmModelsService.getKnowledgeEmbeddingModel.mockReturnValue(
      'text-embedding-3-small',
    );
    mockGitRepositoriesService.encryptCredential.mockImplementation(
      (text: string) => `encrypted:${text}`,
    );
    mockGitRepositoriesService.decryptCredential.mockImplementation(
      (text: string) => text.replace('encrypted:', ''),
    );
    service = new RepoIndexService(
      mockRepoIndexDao as unknown as RepoIndexDao,
      mockGitRepositoriesDao as unknown as GitRepositoriesDao,
      mockGitRepositoriesService as unknown as GitRepositoriesService,
      mockRepoIndexerService as unknown as RepoIndexerService,
      mockRepoIndexQueueService as unknown as RepoIndexQueueService,
      mockLlmModelsService as unknown as LlmModelsService,
      mockOpenaiService as unknown as OpenaiService,
      mockQdrantService as unknown as QdrantService,
      mockRuntimeProvider as unknown as RuntimeProvider,
      mockRuntimeInstanceDao as unknown as RuntimeInstanceDao,
      mockLogger as unknown as DefaultLogger,
    );
    await service.onModuleInit();
  });

  describe('getOrInitIndexForRepo', () => {
    const baseParams = {
      repositoryId: 'repo-uuid',
      repoUrl: 'https://github.com/owner/repo',
      repoRoot: '/workspace/repo',
      branch: 'main',
      execFn,
    };

    it('returns ready when index is completed and up-to-date', async () => {
      const existingEntity = {
        id: 'index-1',
        status: RepoIndexStatus.Completed,
        lastIndexedCommit: 'abc123',
        embeddingModel: 'text-embedding-3-small',
        vectorSize: 1536,
        chunkingSignatureHash: 'sig-hash-123',
      } as unknown as RepoIndexEntity;

      mockRepoIndexDao.getOne.mockResolvedValue(existingEntity);

      const result = await service.getOrInitIndexForRepo(baseParams);

      expect(result.status).toBe('ready');
      expect(mockRepoIndexerService.runFullIndex).not.toHaveBeenCalled();
      expect(mockRepoIndexQueueService.addIndexJob).not.toHaveBeenCalled();
    });

    it('returns in_progress when entity status is in_progress', async () => {
      const existingEntity = {
        id: 'index-1',
        status: RepoIndexStatus.InProgress,
      } as unknown as RepoIndexEntity;

      mockRepoIndexDao.getOne.mockResolvedValue(existingEntity);

      const result = await service.getOrInitIndexForRepo(baseParams);

      expect(result.status).toBe('in_progress');
      expect(mockRepoIndexerService.runFullIndex).not.toHaveBeenCalled();
    });

    it('returns in_progress when entity status is pending', async () => {
      const existingEntity = {
        id: 'index-1',
        status: RepoIndexStatus.Pending,
      } as unknown as RepoIndexEntity;

      mockRepoIndexDao.getOne.mockResolvedValue(existingEntity);

      const result = await service.getOrInitIndexForRepo(baseParams);

      expect(result.status).toBe('in_progress');
    });

    it('runs inline indexing when estimated tokens are below threshold', async () => {
      mockRepoIndexDao.getOne.mockResolvedValueOnce(null); // no existing index for branch
      // Donor query now uses getAll (defaults to []) — no getOne mock needed
      mockRepoIndexerService.estimateTokenCount.mockResolvedValue(1000); // below 30000
      mockRepoIndexDao.create.mockResolvedValue({
        id: 'new-index',
        status: RepoIndexStatus.InProgress,
      } as unknown as RepoIndexEntity);

      const result = await service.getOrInitIndexForRepo(baseParams);

      expect(result.status).toBe('ready');
      expect(mockRepoIndexerService.runFullIndex).toHaveBeenCalled();
      expect(mockRepoIndexQueueService.addIndexJob).not.toHaveBeenCalled();
      expect(mockRepoIndexDao.updateById).toHaveBeenCalledWith(
        'new-index',
        expect.objectContaining({ status: RepoIndexStatus.Completed }),
      );
    });

    it('enqueues background job when estimated tokens exceed threshold', async () => {
      mockRepoIndexDao.getOne.mockResolvedValueOnce(null); // no existing index for branch
      // Donor query now uses getAll (defaults to []) — no getOne mock needed
      mockRepoIndexerService.estimateTokenCount.mockResolvedValue(50000); // above 30000
      mockRepoIndexDao.create.mockResolvedValue({
        id: 'new-index',
        status: RepoIndexStatus.InProgress, // claimIndexSlot creates with InProgress
      } as unknown as RepoIndexEntity);

      const result = await service.getOrInitIndexForRepo(baseParams);

      expect(result.status).toBe('pending');
      expect(mockRepoIndexQueueService.addIndexJob).toHaveBeenCalledWith(
        expect.objectContaining({ repoIndexId: 'new-index', branch: 'main' }),
      );
      expect(mockRepoIndexerService.runFullIndex).not.toHaveBeenCalled();
      // Verify entity was switched from InProgress to Pending for background job
      expect(mockRepoIndexDao.updateById).toHaveBeenCalledWith(
        'new-index',
        expect.objectContaining({ status: RepoIndexStatus.Pending }),
      );
    });

    it('runs incremental index when only commit changed', async () => {
      const existingEntity = {
        id: 'index-1',
        status: RepoIndexStatus.Completed,
        lastIndexedCommit: 'old-commit',
        embeddingModel: 'text-embedding-3-small',
        vectorSize: 1536,
        chunkingSignatureHash: 'sig-hash-123',
      } as unknown as RepoIndexEntity;

      mockRepoIndexDao.getOne.mockResolvedValue(existingEntity);
      // For incremental, estimateChangedTokenCount is used instead of estimateTokenCount
      mockRepoIndexerService.estimateChangedTokenCount.mockResolvedValue(1000);
      mockRepoIndexDao.updateById.mockResolvedValue(existingEntity);

      const result = await service.getOrInitIndexForRepo(baseParams);

      expect(result.status).toBe('ready');
      expect(mockRepoIndexerService.runIncrementalIndex).toHaveBeenCalled();
      expect(mockRepoIndexerService.runFullIndex).not.toHaveBeenCalled();
      // Verify that estimateChangedTokenCount was called for incremental
      expect(
        mockRepoIndexerService.estimateChangedTokenCount,
      ).toHaveBeenCalled();
    });

    it('sets entity to failed on inline indexing error', async () => {
      mockRepoIndexDao.getOne.mockResolvedValueOnce(null); // no existing index for branch
      // Donor query now uses getAll (defaults to []) — no getOne mock needed
      mockRepoIndexerService.estimateTokenCount.mockResolvedValue(1000);
      mockRepoIndexerService.runFullIndex.mockRejectedValue(
        new Error('embed failed'),
      );
      mockRepoIndexDao.create.mockResolvedValue({
        id: 'new-index',
        status: RepoIndexStatus.InProgress,
      } as unknown as RepoIndexEntity);

      await expect(service.getOrInitIndexForRepo(baseParams)).rejects.toThrow(
        'embed failed',
      );

      expect(mockRepoIndexDao.updateById).toHaveBeenCalledWith(
        'new-index',
        expect.objectContaining({
          status: RepoIndexStatus.Failed,
          errorMessage: 'embed failed',
        }),
      );
    });
  });

  describe('searchCodebase', () => {
    const baseSearchParams = {
      collection: 'codebase_my_repo_main_1536',
      query: 'find authentication logic',
      repoId: 'https://github.com/owner/repo',
      topK: 5,
    };

    const makeScoredPoint = (
      path: string,
      text: string,
      score: number,
      startLine = 1,
      endLine = 10,
    ) => ({
      id: `point-${path}`,
      score,
      payload: {
        repo_id: 'https://github.com/owner/repo',
        path,
        start_line: startLine,
        end_line: endLine,
        text,
      },
    });

    beforeEach(() => {
      (mockOpenaiService as Record<string, unknown>).embeddings = vi
        .fn()
        .mockResolvedValue({
          embeddings: [[0.1, 0.2, 0.3]],
        });
      (mockQdrantService as Record<string, unknown>).searchPoints = vi
        .fn()
        .mockResolvedValue([]);
    });

    it('returns filtered search results (happy path)', async () => {
      const points = [
        makeScoredPoint('src/auth/login.ts', 'function login() {}', 0.95),
        makeScoredPoint('src/auth/guard.ts', 'class AuthGuard {}', 0.88),
        makeScoredPoint('src/utils/hash.ts', 'function hashPassword() {}', 0.7),
      ];
      (mockQdrantService as Record<string, unknown>).searchPoints = vi
        .fn()
        .mockResolvedValue(points);

      const results = await service.searchCodebase(baseSearchParams);

      expect(results).toHaveLength(3);
      expect(results[0]!.path).toBe('src/auth/login.ts');
      expect(results[0]!.score).toBe(0.95);
      expect(results[0]!.text).toBe('function login() {}');
      expect(results[0]!.start_line).toBe(1);
      expect(results[0]!.end_line).toBe(10);

      // Verify embedding model was fetched
      expect(
        mockLlmModelsService.getKnowledgeEmbeddingModel,
      ).toHaveBeenCalled();
      // Verify embeddings were requested
      expect(
        (mockOpenaiService as Record<string, unknown>).embeddings,
      ).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['find authentication logic'],
      });
      // Verify search was called with expansion factor (topK * 4 = 20)
      expect(
        (mockQdrantService as Record<string, unknown>).searchPoints,
      ).toHaveBeenCalledWith(
        'codebase_my_repo_main_1536',
        [0.1, 0.2, 0.3],
        20, // topK(5) * SEARCH_EXPANSION_FACTOR(4)
        expect.objectContaining({
          filter: expect.objectContaining({
            must: [
              {
                key: 'repo_id',
                match: { value: 'https://github.com/owner/repo' },
              },
            ],
          }),
          with_payload: true,
        }),
      );
    });

    it('returns empty array when Qdrant collection does not exist', async () => {
      (mockQdrantService as Record<string, unknown>).searchPoints = vi
        .fn()
        .mockRejectedValue(new Error('Collection not found'));

      const results = await service.searchCodebase(baseSearchParams);

      expect(results).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Qdrant collection not found during search',
        expect.objectContaining({
          collection: 'codebase_my_repo_main_1536',
          repoId: 'https://github.com/owner/repo',
        }),
      );
    });

    it('returns empty array when Qdrant collection "does not exist"', async () => {
      (mockQdrantService as Record<string, unknown>).searchPoints = vi
        .fn()
        .mockRejectedValue(new Error('Collection does not exist'));

      const results = await service.searchCodebase(baseSearchParams);

      expect(results).toEqual([]);
    });

    it('rethrows non-"not found" errors from Qdrant', async () => {
      (mockQdrantService as Record<string, unknown>).searchPoints = vi
        .fn()
        .mockRejectedValue(new Error('Connection timeout'));

      await expect(service.searchCodebase(baseSearchParams)).rejects.toThrow(
        'Connection timeout',
      );
    });

    it('filters by language using direct extension match (e.g. "ts")', async () => {
      const points = [
        makeScoredPoint('src/auth/login.ts', 'function login() {}', 0.95),
        makeScoredPoint('src/auth/guard.py', 'class AuthGuard:', 0.88),
        makeScoredPoint('src/config.json', '{"key": "val"}', 0.7),
      ];
      (mockQdrantService as Record<string, unknown>).searchPoints = vi
        .fn()
        .mockResolvedValue(points);

      const results = await service.searchCodebase({
        ...baseSearchParams,
        languageFilter: 'ts',
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.path).toBe('src/auth/login.ts');
    });

    it('filters by language name (e.g. "typescript" matches ts and tsx)', async () => {
      const points = [
        makeScoredPoint('src/auth/login.ts', 'function login() {}', 0.95),
        makeScoredPoint('src/auth/App.tsx', '<Component />', 0.9),
        makeScoredPoint('src/auth/guard.py', 'class AuthGuard:', 0.88),
        makeScoredPoint('src/auth/main.js', 'const x = 1;', 0.7),
      ];
      (mockQdrantService as Record<string, unknown>).searchPoints = vi
        .fn()
        .mockResolvedValue(points);

      const results = await service.searchCodebase({
        ...baseSearchParams,
        languageFilter: 'typescript',
      });

      expect(results).toHaveLength(2);
      expect(results[0]!.path).toBe('src/auth/login.ts');
      expect(results[1]!.path).toBe('src/auth/App.tsx');
    });

    it('filters by directory prefix', async () => {
      const points = [
        makeScoredPoint('src/auth/login.ts', 'function login() {}', 0.95),
        makeScoredPoint('src/auth/guard.ts', 'class AuthGuard {}', 0.88),
        makeScoredPoint('src/utils/hash.ts', 'function hashPassword() {}', 0.7),
        makeScoredPoint('lib/helpers.ts', 'export const helper = 1', 0.6),
      ];
      (mockQdrantService as Record<string, unknown>).searchPoints = vi
        .fn()
        .mockResolvedValue(points);

      const results = await service.searchCodebase({
        ...baseSearchParams,
        directoryFilter: 'src/auth',
      });

      expect(results).toHaveLength(2);
      expect(results[0]!.path).toBe('src/auth/login.ts');
      expect(results[1]!.path).toBe('src/auth/guard.ts');
    });

    it('combines directory and language filters', async () => {
      const points = [
        makeScoredPoint('src/auth/login.ts', 'function login() {}', 0.95),
        makeScoredPoint('src/auth/guard.py', 'class AuthGuard:', 0.88),
        makeScoredPoint('src/utils/hash.ts', 'function hashPassword() {}', 0.7),
      ];
      (mockQdrantService as Record<string, unknown>).searchPoints = vi
        .fn()
        .mockResolvedValue(points);

      const results = await service.searchCodebase({
        ...baseSearchParams,
        directoryFilter: 'src/auth',
        languageFilter: 'ts',
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.path).toBe('src/auth/login.ts');
    });

    it('limits results to topK after filtering', async () => {
      const points = Array.from({ length: 10 }, (_, i) =>
        makeScoredPoint(`src/file${i}.ts`, `code ${i}`, 0.9 - i * 0.05),
      );
      (mockQdrantService as Record<string, unknown>).searchPoints = vi
        .fn()
        .mockResolvedValue(points);

      const results = await service.searchCodebase({
        ...baseSearchParams,
        topK: 3,
      });

      expect(results).toHaveLength(3);
    });

    it('skips results with missing path or text in payload', async () => {
      const points = [
        makeScoredPoint('src/auth/login.ts', 'function login() {}', 0.95),
        {
          id: 'point-no-path',
          score: 0.9,
          payload: { text: 'some text' },
        },
        {
          id: 'point-no-text',
          score: 0.85,
          payload: { path: 'src/file.ts' },
        },
        {
          id: 'point-empty-payload',
          score: 0.8,
          payload: {},
        },
      ];
      (mockQdrantService as Record<string, unknown>).searchPoints = vi
        .fn()
        .mockResolvedValue(points);

      const results = await service.searchCodebase(baseSearchParams);

      expect(results).toHaveLength(1);
      expect(results[0]!.path).toBe('src/auth/login.ts');
    });

    it('throws when embedding generation returns empty result', async () => {
      (mockOpenaiService as Record<string, unknown>).embeddings = vi
        .fn()
        .mockResolvedValue({ embeddings: [] });

      await expect(service.searchCodebase(baseSearchParams)).rejects.toThrow(
        'Failed to generate embedding for query',
      );
    });
  });

  describe('processIndexJob (background path)', () => {
    it('skips when entity is not found', async () => {
      mockRepoIndexDao.getOne.mockResolvedValue(null);

      // Call the private method directly
      await (
        service as unknown as {
          processIndexJob: (data: {
            repoIndexId: string;
            repoUrl: string;
            branch: string;
          }) => Promise<void>;
        }
      ).processIndexJob({
        repoIndexId: 'missing-id',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Repo index entity not found, skipping job',
        { repoIndexId: 'missing-id' },
      );
      expect(mockRepoIndexerService.runFullIndex).not.toHaveBeenCalled();
    });

    it('skips when entity is already completed', async () => {
      mockRepoIndexDao.getOne.mockResolvedValue({
        id: 'done-id',
        status: RepoIndexStatus.Completed,
      } as unknown as RepoIndexEntity);

      await (
        service as unknown as {
          processIndexJob: (data: {
            repoIndexId: string;
            repoUrl: string;
            branch: string;
          }) => Promise<void>;
        }
      ).processIndexJob({
        repoIndexId: 'done-id',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Repo index already completed, skipping job',
        { repoIndexId: 'done-id' },
      );
      expect(mockRepoIndexerService.runFullIndex).not.toHaveBeenCalled();
    });
  });

  describe('cross-branch seeding (via getOrInitIndexForRepo)', () => {
    const baseParams = {
      repositoryId: 'repo-uuid',
      repoUrl: 'https://github.com/owner/repo',
      repoRoot: '/workspace/repo',
      branch: 'feature-branch',
      execFn,
    };

    it('seeds from donor branch when available', async () => {
      // No existing index for the target branch
      mockRepoIndexDao.getOne.mockResolvedValue(null);

      // Donor branch exists with completed index
      mockRepoIndexDao.getAll.mockResolvedValue([
        {
          id: 'donor-index',
          repositoryId: 'repo-uuid',
          branch: 'main',
          status: RepoIndexStatus.Completed,
          lastIndexedCommit: 'donor-commit-abc',
          qdrantCollection: 'codebase_my_repo_main_1536',
        },
      ]);

      mockRepoIndexerService.copyCollectionPoints.mockResolvedValue(500);
      // After seeding, estimateChangedTokenCount is used (incremental path)
      mockRepoIndexerService.estimateChangedTokenCount.mockResolvedValue(500);

      mockRepoIndexDao.create.mockResolvedValue({
        id: 'new-branch-index',
        status: RepoIndexStatus.InProgress,
        estimatedTokens: 500,
      } as unknown as RepoIndexEntity);

      const result = await service.getOrInitIndexForRepo(baseParams);

      expect(result.status).toBe('ready');
      // Should have copied points from donor
      expect(mockRepoIndexerService.copyCollectionPoints).toHaveBeenCalledWith(
        'codebase_my_repo_main_1536',
        'codebase_my_repo_main_1536',
      );
      // Should have run incremental index (not full) because seeding succeeded
      expect(mockRepoIndexerService.runIncrementalIndex).toHaveBeenCalled();
      expect(mockRepoIndexerService.runFullIndex).not.toHaveBeenCalled();
    });

    it('runs full index when no donor branch exists', async () => {
      // No existing index for the target branch
      mockRepoIndexDao.getOne.mockResolvedValue(null);

      // No donor branches (getAll returns empty for completed indexes)
      mockRepoIndexDao.getAll.mockResolvedValue([]);

      mockRepoIndexerService.estimateTokenCount.mockResolvedValue(1000);

      mockRepoIndexDao.create.mockResolvedValue({
        id: 'new-index',
        status: RepoIndexStatus.InProgress,
      } as unknown as RepoIndexEntity);

      const result = await service.getOrInitIndexForRepo(baseParams);

      expect(result.status).toBe('ready');
      // Should NOT have attempted to copy points
      expect(
        mockRepoIndexerService.copyCollectionPoints,
      ).not.toHaveBeenCalled();
      // Should have run full index (no donor to seed from)
      expect(mockRepoIndexerService.runFullIndex).toHaveBeenCalled();
      expect(mockRepoIndexerService.runIncrementalIndex).not.toHaveBeenCalled();
    });
  });

  describe('recoverStuckJobs', () => {
    it('re-enqueues incomplete jobs on startup', async () => {
      // Reset to create a fresh service with incomplete jobs
      vi.resetAllMocks();
      mockRepoIndexDao.getAll.mockResolvedValue([
        {
          id: 'stuck-1',
          repoUrl: 'https://github.com/owner/repo1',
          branch: 'main',
          status: RepoIndexStatus.InProgress,
        },
        {
          id: 'stuck-2',
          repoUrl: 'https://github.com/owner/repo2',
          branch: 'develop',
          status: RepoIndexStatus.Pending,
        },
      ]);
      mockRepoIndexDao.withIndexLock.mockImplementation(
        (_repoId: string, _branch: string, cb: () => Promise<unknown>) => cb(),
      );

      const svc = new RepoIndexService(
        mockRepoIndexDao as unknown as RepoIndexDao,
        mockGitRepositoriesDao as unknown as GitRepositoriesDao,
        mockGitRepositoriesService as unknown as GitRepositoriesService,
        mockRepoIndexerService as unknown as RepoIndexerService,
        mockRepoIndexQueueService as unknown as RepoIndexQueueService,
        mockLlmModelsService as unknown as LlmModelsService,
        mockOpenaiService as unknown as OpenaiService,
        mockQdrantService as unknown as QdrantService,
        mockRuntimeProvider as unknown as RuntimeProvider,
        mockRuntimeInstanceDao as unknown as RuntimeInstanceDao,
        mockLogger as unknown as DefaultLogger,
      );
      await svc.onModuleInit();

      // Verify each stuck job was reset to Pending
      expect(mockRepoIndexDao.updateById).toHaveBeenCalledWith('stuck-1', {
        status: RepoIndexStatus.Pending,
      });
      expect(mockRepoIndexDao.updateById).toHaveBeenCalledWith('stuck-2', {
        status: RepoIndexStatus.Pending,
      });

      // Verify each stuck job was re-enqueued
      expect(mockRepoIndexQueueService.addIndexJob).toHaveBeenCalledWith({
        repoIndexId: 'stuck-1',
        repoUrl: 'https://github.com/owner/repo1',
        branch: 'main',
      });
      expect(mockRepoIndexQueueService.addIndexJob).toHaveBeenCalledWith({
        repoIndexId: 'stuck-2',
        repoUrl: 'https://github.com/owner/repo2',
        branch: 'develop',
      });

      // Verify warning was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Recovering incomplete repo index jobs on startup',
        { count: 2 },
      );
    });

    it('handles no incomplete jobs gracefully', async () => {
      // The default beforeEach already sets getAll to return [] and calls onModuleInit.
      // Verify no jobs were enqueued and no warning was logged.
      expect(mockRepoIndexQueueService.addIndexJob).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        'Recovering incomplete repo index jobs on startup',
        expect.anything(),
      );
    });

    it('handles errors in recovery gracefully', async () => {
      vi.resetAllMocks();
      const recoveryError = new Error('DB connection lost');
      mockRepoIndexDao.getAll.mockRejectedValue(recoveryError);
      mockRepoIndexDao.withIndexLock.mockImplementation(
        (_repoId: string, _branch: string, cb: () => Promise<unknown>) => cb(),
      );

      const svc = new RepoIndexService(
        mockRepoIndexDao as unknown as RepoIndexDao,
        mockGitRepositoriesDao as unknown as GitRepositoriesDao,
        mockGitRepositoriesService as unknown as GitRepositoriesService,
        mockRepoIndexerService as unknown as RepoIndexerService,
        mockRepoIndexQueueService as unknown as RepoIndexQueueService,
        mockLlmModelsService as unknown as LlmModelsService,
        mockOpenaiService as unknown as OpenaiService,
        mockQdrantService as unknown as QdrantService,
        mockRuntimeProvider as unknown as RuntimeProvider,
        mockRuntimeInstanceDao as unknown as RuntimeInstanceDao,
        mockLogger as unknown as DefaultLogger,
      );

      // onModuleInit should NOT throw — recoverStuckJobs catches errors
      await svc.onModuleInit();

      expect(mockLogger.error).toHaveBeenCalledWith(
        recoveryError,
        'Failed to recover incomplete repo index jobs',
      );

      // Verify no jobs were enqueued
      expect(mockRepoIndexQueueService.addIndexJob).not.toHaveBeenCalled();
    });
  });
});
