import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DefaultLogger } from '@packages/common';

import { PROJECT_DELETED_EVENT } from '../projects/projects.events';
import type { ProjectDeletedEvent } from '../projects/projects.events';
import { GitRepositoriesDao } from './dao/git-repositories.dao';

@Injectable()
export class GitRepositoriesListener {
  constructor(
    private readonly gitRepositoriesDao: GitRepositoriesDao,
    private readonly logger: DefaultLogger,
  ) {}

  @OnEvent(PROJECT_DELETED_EVENT)
  async onProjectDeleted(event: ProjectDeletedEvent): Promise<void> {
    try {
      this.logger.log(
        `Deleting git repositories for project ${event.projectId} by user ${event.userId}`,
      );
      await this.gitRepositoriesDao.delete({
        projectId: event.projectId,
        createdBy: event.userId,
      });
    } catch (error) {
      this.logger.error(
        error as Error,
        `Failed to delete git repositories for project ${event.projectId} by user ${event.userId}`,
      );
      throw error;
    }
  }
}
