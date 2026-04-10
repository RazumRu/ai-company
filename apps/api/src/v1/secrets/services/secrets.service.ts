import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { ConflictException, NotFoundException } from '@packages/common';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { SecretsStoreService } from '../../secrets-store/services/secrets-store.service';
import { SecretsDao } from '../dao/secrets.dao';
import {
  CreateSecretDto,
  SecretResponseDto,
  UpdateSecretDto,
} from '../dto/secrets.dto';
import { SecretEntity } from '../entity/secret.entity';

@Injectable()
export class SecretsService {
  constructor(
    private readonly secretsDao: SecretsDao,
    private readonly secretsStore: SecretsStoreService,
    private readonly em: EntityManager,
  ) {}

  async create(
    ctx: AppContextStorage,
    dto: CreateSecretDto,
  ): Promise<SecretResponseDto> {
    const userId = ctx.checkSub();
    const projectId = ctx.checkProjectId();

    const existing = await this.secretsDao.getOne({
      projectId,
      name: dto.name,
    });
    if (existing) {
      throw new ConflictException(
        'SECRET_NAME_EXISTS',
        `Secret "${dto.name}" already exists`,
      );
    }

    return await this.em.transactional(async (em) => {
      const entity = await this.secretsDao.create(
        {
          name: dto.name,
          description: dto.description ?? null,
          createdBy: userId,
          projectId,
        },
        em,
      );
      await this.secretsStore.putSecret(projectId, dto.name, dto.value);
      return this.toResponse(entity);
    });
  }

  async list(ctx: AppContextStorage): Promise<SecretResponseDto[]> {
    const projectId = ctx.checkProjectId();
    const entities = await this.secretsDao.getAll(
      { projectId },
      { orderBy: { name: 'asc' } },
    );
    return entities.map((e) => this.toResponse(e));
  }

  async getById(
    ctx: AppContextStorage,
    id: string,
  ): Promise<SecretResponseDto> {
    const projectId = ctx.checkProjectId();
    const entity = await this.secretsDao.getOne({ id, projectId });
    if (!entity) {
      throw new NotFoundException('SECRET_NOT_FOUND');
    }
    return this.toResponse(entity);
  }

  async update(
    ctx: AppContextStorage,
    id: string,
    dto: UpdateSecretDto,
  ): Promise<SecretResponseDto> {
    const projectId = ctx.checkProjectId();
    const entity = await this.secretsDao.getOne({ id, projectId });
    if (!entity) {
      throw new NotFoundException('SECRET_NOT_FOUND');
    }

    if (dto.value !== undefined) {
      await this.secretsStore.putSecret(projectId, entity.name, dto.value);
    }

    return await this.em.transactional(async (em) => {
      if (dto.description !== undefined) {
        entity.description = dto.description;
      }
      await em.flush();
      return this.toResponse(entity);
    });
  }

  async delete(ctx: AppContextStorage, id: string): Promise<void> {
    const projectId = ctx.checkProjectId();
    const entity = await this.secretsDao.getOne({ id, projectId });
    if (!entity) {
      throw new NotFoundException('SECRET_NOT_FOUND');
    }

    await this.secretsDao.deleteById(id);
    await this.secretsStore.deleteSecret(projectId, entity.name);
  }

  /** Resolve a secret value by name for a given project. Used by graph compiler. */
  async resolveSecretValue(
    projectId: string,
    secretName: string,
  ): Promise<string> {
    const entity = await this.secretsDao.getOne({
      projectId,
      name: secretName,
    });
    if (!entity) {
      throw new NotFoundException(
        'SECRET_NOT_FOUND',
        `Secret "${secretName}" not found`,
      );
    }
    return this.secretsStore.getSecret(projectId, secretName);
  }

  /**
   * Batch-resolve multiple secret values for a given project in a single DB
   * query + parallel vault fetches. Returns a map of secretName -> value.
   * Throws NotFoundException if any requested secret name does not exist in DB.
   */
  async batchResolveSecretValues(
    projectId: string,
    secretNames: string[],
  ): Promise<Map<string, string>> {
    if (secretNames.length === 0) {
      return new Map();
    }

    const entities = await this.secretsDao.getAll({
      projectId,
      name: { $in: secretNames },
    });

    const foundNames = new Set(entities.map((e) => e.name));
    for (const name of secretNames) {
      if (!foundNames.has(name)) {
        throw new NotFoundException(
          'SECRET_NOT_FOUND',
          `Secret "${name}" not found`,
        );
      }
    }

    const values = await Promise.all(
      secretNames.map((name) => this.secretsStore.getSecret(projectId, name)),
    );

    const result = new Map<string, string>();
    for (let i = 0; i < secretNames.length; i++) {
      result.set(secretNames[i]!, values[i]!);
    }
    return result;
  }

  private toResponse(entity: SecretEntity): SecretResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description ?? null,
      projectId: entity.projectId,
      createdBy: entity.createdBy,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    } as SecretResponseDto;
  }
}
