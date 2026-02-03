import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';

import { GitRepositoriesDao } from '../dao/git-repositories.dao';
import {
  CreateRepository,
  GetRepositoriesQueryDto,
  GitRepositoryDto,
} from '../dto/git-repositories.dto';
import { GitRepositoryEntity } from '../entity/git-repository.entity';

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
    });

    return this.prepareRepositoryResponse(created);
  }

  async updateRepository(
    ctx: AuthContextStorage,
    id: string,
    data: Partial<CreateRepository>,
  ): Promise<GitRepositoryDto> {
    const userId = ctx.checkSub();

    // Verify ownership
    const existing = await this.gitRepositoriesDao.getOne({
      id,
      createdBy: userId,
    });

    if (!existing) {
      throw new NotFoundException('REPOSITORY_NOT_FOUND');
    }

    const updated = await this.gitRepositoriesDao.updateById(id, data);

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
}
