import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { ProjectsController } from './controllers/projects.controller';
import { ProjectsDao } from './dao/projects.dao';
import { ProjectsStatsDao } from './dao/projects-stats.dao';
import { ProjectEntity } from './entity/project.entity';
import { ProjectsService } from './services/projects.service';

@Module({
  imports: [registerEntities([ProjectEntity])],
  controllers: [ProjectsController],
  providers: [ProjectsDao, ProjectsStatsDao, ProjectsService],
  exports: [ProjectsDao, ProjectsStatsDao, ProjectsService],
})
export class ProjectsModule {}
