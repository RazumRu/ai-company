import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { LitellmModule } from '../litellm/litellm.module';
import { OpenaiModule } from '../openai/openai.module';
import { QdrantModule } from '../qdrant/qdrant.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { GitRepositoriesController } from './controllers/git-repositories.controller';
import { GitRepositoriesDao } from './dao/git-repositories.dao';
import { RepoIndexDao } from './dao/repo-index.dao';
import { GitRepositoryEntity } from './entity/git-repository.entity';
import { RepoIndexEntity } from './entity/repo-index.entity';
import { GitRepositoriesService } from './services/git-repositories.service';
import { RepoIndexService } from './services/repo-index.service';
import { RepoIndexQueueService } from './services/repo-index-queue.service';
import { RepoIndexerService } from './services/repo-indexer.service';

@Module({
  imports: [
    registerEntities([GitRepositoryEntity, RepoIndexEntity]),
    RuntimeModule,
    QdrantModule,
    LitellmModule,
    OpenaiModule,
  ],
  controllers: [GitRepositoriesController],
  providers: [
    GitRepositoriesService,
    GitRepositoriesDao,
    RepoIndexDao,
    RepoIndexerService,
    RepoIndexQueueService,
    RepoIndexService,
  ],
  exports: [GitRepositoriesService, GitRepositoriesDao, RepoIndexService],
})
export class GitRepositoriesModule {}
