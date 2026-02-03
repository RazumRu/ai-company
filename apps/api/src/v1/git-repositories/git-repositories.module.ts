import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { GitRepositoriesController } from './controllers/git-repositories.controller';
import { GitRepositoriesDao } from './dao/git-repositories.dao';
import { GitRepositoryEntity } from './entity/git-repository.entity';
import { GitRepositoriesService } from './services/git-repositories.service';

@Module({
  imports: [registerEntities([GitRepositoryEntity])],
  controllers: [GitRepositoriesController],
  providers: [GitRepositoriesService, GitRepositoriesDao],
  exports: [GitRepositoriesService, GitRepositoriesDao],
})
export class GitRepositoriesModule {}
