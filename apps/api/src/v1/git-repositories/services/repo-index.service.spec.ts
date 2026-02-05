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
  deriveRepoSlug: vi.fn().mockReturnValue('my_repo'),
  buildCollectionName: vi.fn().mockReturnValue('codebase_my_repo_main_1536'),
  runFullIndex: vi.fn().mockResolvedValue(undefined),
  runIncrementalIndex: vi.fn().mockResolvedValue(undefined),
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
    vi.clearAllMocks();
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
      mockRepoIndexDao.getOne.mockResolvedValue(null);
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
      mockRepoIndexDao.getOne.mockResolvedValue(null);
      mockRepoIndexerService.estimateTokenCount.mockResolvedValue(50000); // above 30000
      mockRepoIndexDao.create.mockResolvedValue({
        id: 'new-index',
        status: RepoIndexStatus.Pending,
      } as unknown as RepoIndexEntity);

      const result = await service.getOrInitIndexForRepo(baseParams);

      expect(result.status).toBe('pending');
      expect(mockRepoIndexQueueService.addIndexJob).toHaveBeenCalledWith(
        expect.objectContaining({ repoIndexId: 'new-index' }),
      );
      expect(mockRepoIndexerService.runFullIndex).not.toHaveBeenCalled();
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
      mockRepoIndexDao.getOne.mockResolvedValue(null);
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
});
