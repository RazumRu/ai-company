import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InternalException, NotFoundException } from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';

import { environment } from '../../../environments';
import { GitRepositoriesDao } from '../dao/git-repositories.dao';
import {
  CreateRepository,
  GetRepositoriesQueryDto,
  GitRepositoryDto,
  UpdateRepository,
} from '../dto/git-repositories.dto';
import { GitRepositoryEntity } from '../entity/git-repository.entity';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_HEX_LENGTH = 64; // 32 bytes = 256 bits

@Injectable()
export class GitRepositoriesService {
  constructor(private readonly gitRepositoriesDao: GitRepositoriesDao) {}

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
