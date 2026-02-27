import { forwardRef, Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { GitRepositoriesModule } from '../git-repositories/git-repositories.module';
import { GraphsModule } from '../graphs/graphs.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ProjectsController } from './controllers/projects.controller';
import { ProjectsDao } from './dao/projects.dao';
import { ProjectsStatsDao } from './dao/projects-stats.dao';
import { ProjectEntity } from './entity/project.entity';
import { ProjectsService } from './services/projects.service';

@Module({
  imports: [
    registerEntities([ProjectEntity]),
    forwardRef(() => GraphsModule),
    forwardRef(() => KnowledgeModule),
    forwardRef(() => GitRepositoriesModule),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsDao, ProjectsStatsDao, ProjectsService],
  exports: [ProjectsDao, ProjectsStatsDao, ProjectsService],
})
export class ProjectsModule {}
