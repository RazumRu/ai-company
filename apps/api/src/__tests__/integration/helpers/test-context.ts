import { INestApplication } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { ProjectsDao } from '../../../v1/projects/dao/projects.dao';
import { TEST_USER_ID } from '../setup';

/**
 * Build an AppContextStorage for a given user and optional project ID.
 * Used by integration tests to supply the x-project-id header required by
 * services that call ctx.checkProjectId().
 */
export const buildTestContext = (
  userId: string,
  projectId?: string,
): AppContextStorage => {
  const headers: Record<string, string> = {};
  if (projectId) {
    headers['x-project-id'] = projectId;
  }
  return new AppContextStorage({ sub: userId }, {
    headers,
  } as unknown as FastifyRequest);
};

/**
 * Create a test project owned by userId and return an AppContextStorage
 * that includes the new project's ID in the x-project-id header.
 * Also returns the project ID so the caller can clean it up in afterAll.
 */
export const createTestProject = async (
  app: INestApplication,
  userId: string = TEST_USER_ID,
): Promise<{ projectId: string; ctx: AppContextStorage }> => {
  const projectsDao = app.get(ProjectsDao);
  const project = await projectsDao.create({
    name: `Test Project ${Date.now()}`,
    description: null,
    icon: null,
    color: null,
    settings: {},
    createdBy: userId,
  });
  const ctx = buildTestContext(userId, project.id);
  return { projectId: project.id, ctx };
};
