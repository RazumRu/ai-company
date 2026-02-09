import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LitellmService } from '../../litellm/services/litellm.service';
import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';
import { QdrantService } from '../../qdrant/services/qdrant.service';
import { RepoIndexDao } from '../dao/repo-index.dao';
import { RepoExecFn, RepoIndexerService } from './repo-indexer.service';

const mockQdrantService = {
  deleteByFilter: vi.fn().mockResolvedValue(undefined),
  upsertPoints: vi.fn().mockResolvedValue(undefined),
  ensureCollection: vi.fn().mockResolvedValue(undefined),
  scrollAll: vi.fn().mockResolvedValue([]),
  scrollAllWithVectors: vi.fn().mockResolvedValue([]),
  buildSizedCollectionName: vi.fn(
    (base: string, size: number) => `${base}_${size}`,
  ),
  getVectorSizeFromEmbeddings: vi.fn(() => 3),
};

const mockOpenaiService = {
  embeddings: vi.fn().mockResolvedValue({
    embeddings: [[0.1, 0.2, 0.3]],
    usage: { prompt_tokens: 1, completion_tokens: 0 },
  }),
};

const mockLitellmService = {
  getTokenizer: vi.fn().mockResolvedValue({
    encode: vi.fn((text: string) =>
      Array.from({ length: text.length }, (_, i) => i),
    ),
    decode: vi.fn((tokens: number[]) => tokens.map(() => 'a').join('')),
  }),
  countTokens: vi.fn().mockResolvedValue(10),
};

const mockLlmModelsService = {
  getKnowledgeEmbeddingModel: vi.fn(() => 'text-embedding-3-small'),
};

const mockRepoIndexDao = {};

const mockLogger = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

describe('RepoIndexerService', () => {
  let service: RepoIndexerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RepoIndexerService(
      mockQdrantService as unknown as QdrantService,
      mockOpenaiService as unknown as OpenaiService,
      mockLitellmService as unknown as LitellmService,
      mockLlmModelsService as unknown as LlmModelsService,
      mockRepoIndexDao as unknown as RepoIndexDao,
      mockLogger as unknown as DefaultLogger,
    );
  });

  describe('estimateTokenCount', () => {
    it('sums file sizes from git ls-tree and divides by 4', async () => {
      const execFn: RepoExecFn = vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: [
          '100644 blob abc123    1000\tsrc/index.ts',
          '100644 blob def456    2000\tsrc/utils.ts',
          '100644 blob ghi789     500\tREADME.md',
        ].join('\n'),
        stderr: '',
      });

      const result = await service.estimateTokenCount('/repo', execFn);
      expect(result).toBe(Math.floor(3500 / 4));
    });

    it('returns 0 when git command fails', async () => {
      const execFn: RepoExecFn = vi.fn().mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'fatal: not a git repo',
      });

      const result = await service.estimateTokenCount('/repo', execFn);
      expect(result).toBe(0);
    });
  });

  describe('deriveRepoId', () => {
    it('normalizes SSH URLs to HTTPS', () => {
      expect(service.deriveRepoId('git@github.com:owner/repo.git')).toBe(
        'https://github.com/owner/repo',
      );
    });

    it('strips .git suffix from HTTPS URLs', () => {
      expect(service.deriveRepoId('https://github.com/owner/repo.git')).toBe(
        'https://github.com/owner/repo',
      );
    });

    it('leaves clean HTTPS URLs unchanged', () => {
      expect(service.deriveRepoId('https://github.com/owner/repo')).toBe(
        'https://github.com/owner/repo',
      );
    });
  });

  describe('deriveRepoSlug', () => {
    it('produces a lowercase alphanumeric slug', () => {
      const slug = service.deriveRepoSlug('https://github.com/MyOrg/My-Repo');
      expect(slug).toMatch(/^[a-z0-9_]+$/);
    });

    it('truncates and appends hash for long IDs', () => {
      const longId = 'https://github.com/' + 'a'.repeat(200);
      const slug = service.deriveRepoSlug(longId);
      expect(slug.length).toBeLessThanOrEqual(69); // 60 + 1 + 8
    });
  });

  describe('buildCollectionName', () => {
    it('includes repo slug and vector size', () => {
      const name = service.buildCollectionName('my_repo', 1536);
      expect(name).toBe('codebase_my_repo_1536');
    });

    it('works with different vector sizes', () => {
      const name = service.buildCollectionName('my_repo', 768);
      expect(name).toBe('codebase_my_repo_768');
    });

    it('includes branch slug when provided', () => {
      const name = service.buildCollectionName('my_repo', 1536, 'main');
      expect(name).toBe('codebase_my_repo_main_1536');
    });

    it('includes branch slug with different vector size', () => {
      const name = service.buildCollectionName('my_repo', 768, 'feature_xyz');
      expect(name).toBe('codebase_my_repo_feature_xyz_768');
    });
  });

  describe('deriveBranchSlug', () => {
    it('returns simple branch names as-is in lowercase', () => {
      expect(service.deriveBranchSlug('main')).toBe('main');
    });

    it('replaces slashes and hyphens with underscores', () => {
      expect(service.deriveBranchSlug('feature/my-feature')).toBe(
        'feature_my_feature',
      );
    });

    it('lowercases uppercase branch names', () => {
      expect(service.deriveBranchSlug('MAIN')).toBe('main');
    });

    it('truncates long branch names and appends hash suffix', () => {
      const longBranch = 'feature/' + 'a'.repeat(50);
      const slug = service.deriveBranchSlug(longBranch);
      // Should be truncated to 20 chars + '_' + 8-char hash = 29 chars
      expect(slug.length).toBeLessThanOrEqual(29);
      expect(slug).toMatch(/^[a-z0-9_]+$/);
      // The first part should be the truncated sanitized name
      expect(slug.slice(0, 20)).toBe(
        longBranch
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 20),
      );
    });
  });

  describe('copyCollectionPoints', () => {
    it('returns 0 when source collection is empty', async () => {
      mockQdrantService.scrollAllWithVectors.mockResolvedValue([]);

      const result = await service.copyCollectionPoints(
        'source_collection',
        'target_collection',
      );

      expect(result).toBe(0);
      expect(mockQdrantService.scrollAllWithVectors).toHaveBeenCalledWith(
        'source_collection',
        expect.objectContaining({
          limit: 1000,
          with_payload: true,
          with_vector: true,
        }),
      );
      expect(mockQdrantService.upsertPoints).not.toHaveBeenCalled();
    });

    it('copies all points from source to target collection', async () => {
      const mockPoints = [
        {
          id: 'point-1',
          vector: [0.1, 0.2, 0.3],
          payload: { repo_id: 'repo1', path: 'file1.ts', text: 'content1' },
        },
        {
          id: 'point-2',
          vector: [0.4, 0.5, 0.6],
          payload: { repo_id: 'repo1', path: 'file2.ts', text: 'content2' },
        },
      ];
      mockQdrantService.scrollAllWithVectors.mockResolvedValueOnce(mockPoints);

      const result = await service.copyCollectionPoints(
        'source_collection',
        'target_collection',
      );

      expect(result).toBe(2);
      expect(mockQdrantService.upsertPoints).toHaveBeenCalledWith(
        'target_collection',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'point-1',
            vector: [0.1, 0.2, 0.3],
            payload: expect.objectContaining({ repo_id: 'repo1' }),
          }),
          expect.objectContaining({
            id: 'point-2',
            vector: [0.4, 0.5, 0.6],
            payload: expect.objectContaining({ repo_id: 'repo1' }),
          }),
        ]),
      );
    });
  });

  describe('getChunkingSignatureHash', () => {
    it('returns a consistent hex string', () => {
      const hash1 = service.getChunkingSignatureHash();
      const hash2 = service.getChunkingSignatureHash();
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{40}$/);
    });
  });

  describe('runFullIndex', () => {
    it('deletes old points and upserts new ones', async () => {
      const execFn: RepoExecFn = vi.fn().mockImplementation(async (params) => {
        if (params.cmd.includes('ls-files')) {
          return { exitCode: 0, stdout: 'src/index.ts\n', stderr: '' };
        }
        if (params.cmd.includes('.codebaseindexignore')) {
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        if (params.cmd.includes('wc -c')) {
          return { exitCode: 0, stdout: '100\n', stderr: '' };
        }
        if (params.cmd.includes('cat')) {
          return { exitCode: 0, stdout: 'export const x = 1;\n', stderr: '' };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      });

      mockOpenaiService.embeddings.mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
        usage: null,
      });

      await service.runFullIndex(
        {
          repoId: 'https://github.com/owner/repo',
          repoRoot: '/workspace/repo',
          currentCommit: 'abc123',
          collection: 'codebase_test_main_3',
          vectorSize: 3,
          embeddingModel: 'text-embedding-3-small',
        },
        execFn,
      );

      expect(mockQdrantService.deleteByFilter).toHaveBeenCalledWith(
        'codebase_test_main_3',
        expect.objectContaining({ must: expect.any(Array) }),
      );
      expect(mockQdrantService.upsertPoints).toHaveBeenCalled();
    });
  });

  describe('resolveCurrentCommit', () => {
    it('returns trimmed stdout from git rev-parse HEAD', async () => {
      const execFn: RepoExecFn = vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'abc123def456\n',
        stderr: '',
      });

      const commit = await service.resolveCurrentCommit('/repo', execFn);
      expect(commit).toBe('abc123def456');
    });
  });

  describe('getCurrentBranch', () => {
    it('returns trimmed branch name', async () => {
      const execFn: RepoExecFn = vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'feature/my-branch\n',
        stderr: '',
      });

      const branch = await service.getCurrentBranch('/repo', execFn);
      expect(branch).toBe('feature/my-branch');
    });
  });
});
