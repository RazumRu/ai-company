import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  BadRequestException,
  InternalException,
  NotFoundException,
} from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';

import { environment } from '../../../environments';
import { GitRepositoriesDao } from '../dao/git-repositories.dao';
import { RepoIndexDao } from '../dao/repo-index.dao';
import {
  CreateRepository,
  GetRepoIndexesQueryDto,
  GetRepositoriesQueryDto,
  GitRepositoryDto,
  RepoIndexDto,
  TriggerReindex,
  TriggerReindexResponse,
  UpdateRepository,
} from '../dto/git-repositories.dto';
import { GitRepositoryEntity } from '../entity/git-repository.entity';
import { RepoIndexEntity } from '../entity/repo-index.entity';
import { RepoIndexStatus } from '../git-repositories.types';
import { RepoIndexQueueService } from './repo-index-queue.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_HEX_LENGTH = 64; // 32 bytes = 256 bits

@Injectable()
export class GitRepositoriesService {
  constructor(
    private readonly gitRepositoriesDao: GitRepositoriesDao,
    private readonly repoIndexDao: RepoIndexDao,
    private readonly repoIndexQueueService: RepoIndexQueueService,
  ) {}

  async createRepository(
    ctx: AuthContextStorage,
    data: CreateRepository,
  ): Promise<GitRepositoryDto> {
    const userId = ctx.checkSub();

    const created = await this.gitRepositoriesDao.create({
      owner: data.owner,
      repo: data.repo,
      url: data.url,
      provider: data.provider,
      createdBy: userId,
      encryptedToken: data.token ? this.encryptCredential(data.token) : null,
    });

    return this.prepareRepositoryResponse(created);
  }

  async updateRepository(
    ctx: AuthContextStorage,
    id: string,
    data: UpdateRepository,
  ): Promise<GitRepositoryDto> {
    const userId = ctx.checkSub();

    const existing = await this.gitRepositoriesDao.getOne({
      id,
      createdBy: userId,
    });

    if (!existing) {
      throw new NotFoundException('REPOSITORY_NOT_FOUND');
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.url) {
      updatePayload.url = data.url;
    }
    if (data.token) {
      updatePayload.encryptedToken = this.encryptCredential(data.token);
    }

    const updated = await this.gitRepositoriesDao.updateById(id, updatePayload);

    return this.prepareRepositoryResponse(updated!);
  }

  async getRepositories(
    ctx: AuthContextStorage,
    query: GetRepositoriesQueryDto,
  ): Promise<GitRepositoryDto[]> {
    const userId = ctx.checkSub();

    const repositories = await this.gitRepositoriesDao.getAll({
      createdBy: userId,
      owner: query.owner,
      repo: query.repo,
      provider: query.provider,
      limit: query.limit,
      offset: query.offset,
      order: { createdAt: 'DESC' },
    });

    return repositories.map((repo) => this.prepareRepositoryResponse(repo));
  }

  async getRepositoryById(
    ctx: AuthContextStorage,
    id: string,
  ): Promise<GitRepositoryDto> {
    const userId = ctx.checkSub();

    const repository = await this.gitRepositoriesDao.getOne({
      id,
      createdBy: userId,
    });

    if (!repository) {
      throw new NotFoundException('REPOSITORY_NOT_FOUND');
    }

    return this.prepareRepositoryResponse(repository);
  }

  async deleteRepository(ctx: AuthContextStorage, id: string): Promise<void> {
    const userId = ctx.checkSub();

    // Verify repository exists and belongs to user
    const repository = await this.gitRepositoriesDao.getOne({
      id,
      createdBy: userId,
    });

    if (!repository) {
      throw new NotFoundException('REPOSITORY_NOT_FOUND');
    }

    await this.gitRepositoriesDao.deleteById(id);
  }

  async getRepoIndexes(
    ctx: AuthContextStorage,
    query: GetRepoIndexesQueryDto,
  ): Promise<RepoIndexDto[]> {
    const userId = ctx.checkSub();

    // If repositoryId is provided, verify it belongs to the user
    if (query.repositoryId) {
      const repository = await this.gitRepositoriesDao.getOne({
        id: query.repositoryId,
        createdBy: userId,
      });

      if (!repository) {
        throw new NotFoundException('REPOSITORY_NOT_FOUND');
      }
    }

    // Get all repositories for the user to filter indexes
    const userRepos = await this.gitRepositoriesDao.getAll({
      createdBy: userId,
    });

    const userRepoIds = new Set(userRepos.map((repo) => repo.id));

    // Build search params
    const searchParams: Parameters<typeof this.repoIndexDao.getAll>[0] = {
      limit: query.limit,
      offset: query.offset,
      order: { createdAt: 'DESC' },
    };

    if (query.repositoryId) {
      searchParams.repositoryId = query.repositoryId;
    }

    if (query.status) {
      searchParams.status = query.status as RepoIndexStatus;
    }

    const indexes = await this.repoIndexDao.getAll(searchParams);

    // Filter to only include indexes for user's repositories
    const filteredIndexes = indexes.filter((index) =>
      userRepoIds.has(index.repositoryId),
    );

    return filteredIndexes.map((index) => this.prepareRepoIndexResponse(index));
  }

  async getRepoIndexByRepositoryId(
    ctx: AuthContextStorage,
    repositoryId: string,
  ): Promise<RepoIndexDto | null> {
    const userId = ctx.checkSub();

    // Verify repository belongs to user
    const repository = await this.gitRepositoriesDao.getOne({
      id: repositoryId,
      createdBy: userId,
    });

    if (!repository) {
      throw new NotFoundException('REPOSITORY_NOT_FOUND');
    }

    const index = await this.repoIndexDao.getOne({
      repositoryId,
    });

    if (!index) {
      return null;
    }

    return this.prepareRepoIndexResponse(index);
  }

  async triggerReindex(
    ctx: AuthContextStorage,
    data: TriggerReindex,
  ): Promise<TriggerReindexResponse> {
    const userId = ctx.checkSub();

    // Verify repository belongs to user
    const repository = await this.gitRepositoriesDao.getOne({
      id: data.repositoryId,
      createdBy: userId,
    });

    if (!repository) {
      throw new NotFoundException('REPOSITORY_NOT_FOUND');
    }

    // Check if indexing is already in progress
    const existingIndex = await this.repoIndexDao.getOne({
      repositoryId: data.repositoryId,
    });

    if (
      existingIndex &&
      (existingIndex.status === RepoIndexStatus.InProgress ||
        existingIndex.status === RepoIndexStatus.Pending)
    ) {
      throw new BadRequestException('INDEXING_ALREADY_IN_PROGRESS');
    }

    // Reset the index to pending status and enqueue
    let repoIndex: RepoIndexEntity;

    if (existingIndex) {
      // Reset existing index
      await this.repoIndexDao.updateById(existingIndex.id, {
        status: RepoIndexStatus.Pending,
        errorMessage: null,
        indexedTokens: 0,
      });
      repoIndex = {
        ...existingIndex,
        status: RepoIndexStatus.Pending,
        errorMessage: null,
        indexedTokens: 0,
      };
    } else {
      // Create new index entry (shouldn't normally happen, but handle gracefully)
      repoIndex = await this.repoIndexDao.create({
        repositoryId: data.repositoryId,
        repoUrl: repository.url,
        status: RepoIndexStatus.Pending,
        qdrantCollection: '',
        lastIndexedCommit: null,
        embeddingModel: null,
        vectorSize: null,
        chunkingSignatureHash: null,
        estimatedTokens: null,
        indexedTokens: 0,
        errorMessage: null,
      });
    }

    // Enqueue the indexing job
    await this.repoIndexQueueService.addIndexJob({
      repoIndexId: repoIndex.id,
      repoUrl: repository.url,
    });

    return {
      repoIndex: this.prepareRepoIndexResponse(repoIndex),
      message: 'Repository indexing has been queued',
    };
  }

  private prepareRepositoryResponse(
    entity: GitRepositoryEntity,
  ): GitRepositoryDto {
    return {
      id: entity.id,
      owner: entity.owner,
      repo: entity.repo,
      url: entity.url,
      provider: entity.provider,
      createdBy: entity.createdBy,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }

  private prepareRepoIndexResponse(entity: RepoIndexEntity): RepoIndexDto {
    return {
      id: entity.id,
      repositoryId: entity.repositoryId,
      repoUrl: entity.repoUrl,
      status: entity.status,
      qdrantCollection: entity.qdrantCollection,
      lastIndexedCommit: entity.lastIndexedCommit,
      embeddingModel: entity.embeddingModel,
      vectorSize: entity.vectorSize,
      chunkingSignatureHash: entity.chunkingSignatureHash,
      estimatedTokens: entity.estimatedTokens,
      indexedTokens: entity.indexedTokens,
      errorMessage: entity.errorMessage,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Credential encryption
  // ---------------------------------------------------------------------------

  private parseKey(key: string | undefined): Buffer {
    if (!key || key.length !== KEY_HEX_LENGTH) {
      throw new InternalException('CREDENTIAL_ENCRYPTION_KEY_MISSING');
    }
    return Buffer.from(key, 'hex');
  }

  encryptCredential(plaintext: string): string {
    const keyBuffer = this.parseKey(environment.credentialEncryptionKey);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag().toString('base64');
    const ivBase64 = iv.toString('base64');

    return `${ivBase64}:${authTag}:${encrypted}`;
  }

  decryptCredential(ciphertext: string): string {
    const keyBuffer = this.parseKey(environment.credentialEncryptionKey);

    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new InternalException('DECRYPTION_FAILED');
    }

    const [ivBase64, authTagBase64, encrypted] = parts;

    try {
      const iv = Buffer.from(ivBase64!, 'base64');
      const authTag = Buffer.from(authTagBase64!, 'base64');
      const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted!, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch {
      throw new InternalException('DECRYPTION_FAILED');
    }
  }
}
