import type { INestApplication } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { GitProviderConnectionDao } from '../../../v1/git-auth/dao/git-provider-connection.dao';
import { GitHubAppProviderService } from '../../../v1/git-auth/services/github-app-provider.service';
import { GitHubAppService } from '../../../v1/git-auth/services/github-app.service';
import { GitProvider } from '../../../v1/git-auth/types/git-provider.enum';
import { GitRepositoriesDao } from '../../../v1/git-repositories/dao/git-repositories.dao';
import { GitRepositoryProvider } from '../../../v1/git-repositories/git-repositories.types';
import { GitRepositoriesService } from '../../../v1/git-repositories/services/git-repositories.service';
import { ProjectsDao } from '../../../v1/projects/dao/projects.dao';
import { createTestModule, TEST_USER_ID } from '../setup';

const TEST_PROJECT_ID = '99999999-9999-9999-9999-999999999901';

// ctx that carries both sub and projectId
const ctx = new AppContextStorage(
  { sub: TEST_USER_ID },
  { headers: { 'x-project-id': TEST_PROJECT_ID } } as unknown as FastifyRequest,
);

const makeGithubResponse = (
  repos: Array<{ owner: string; name: string; html_url: string; default_branch: string }>,
): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      total_count: repos.length,
      repositories: repos.map((r) => ({
        owner: { login: r.owner },
        name: r.name,
        html_url: r.html_url,
        default_branch: r.default_branch,
      })),
    }),
    headers: { get: () => null },
  }) as unknown as Response;

describe('GitRepositoriesService sync (integration)', () => {
  let app: INestApplication;
  let gitRepositoriesService: GitRepositoriesService;
  let gitRepositoriesDao: GitRepositoriesDao;
  let gitProviderConnectionDao: GitProviderConnectionDao;
  let gitHubAppProviderService: GitHubAppProviderService;
  let gitHubAppService: GitHubAppService;
  let projectsDao: ProjectsDao;

  const createdRepoIds: string[] = [];
  const createdInstallationIds: string[] = [];
  let projectCreated = false;

  beforeAll(async () => {
    app = await createTestModule();
    gitRepositoriesService = app.get(GitRepositoriesService);
    gitRepositoriesDao = app.get(GitRepositoriesDao);
    gitProviderConnectionDao = app.get(GitProviderConnectionDao);
    gitHubAppProviderService = app.get(GitHubAppProviderService);
    gitHubAppService = app.get(GitHubAppService);
    projectsDao = app.get(ProjectsDao);

    // Create a test project with a deterministic ID so ctx.checkProjectId() resolves correctly.
    // projectsDao.create() auto-generates a UUID — we insert directly via the DAO raw query.
    // Instead, use the DAO's create and track the created project for cleanup.
    const existingProject = await projectsDao.getOne({ id: TEST_PROJECT_ID });
    if (!existingProject) {
      // Insert with an explicit ID using the TypeORM DataSource directly
      const dataSource = app.get(DataSource);
      await dataSource.query(
        `INSERT INTO projects (id, name, "createdBy", settings, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [TEST_PROJECT_ID, 'Sync Integration Test Project', TEST_USER_ID, '{}'],
      );
      projectCreated = true;
    }
  }, 360_000);

  beforeEach(() => {
    // Always mock isConfigured to return true so tests don't depend on env vars
    vi.spyOn(gitHubAppProviderService, 'isConfigured').mockReturnValue(true);
    vi.spyOn(gitHubAppService, 'getInstallationToken').mockResolvedValue('ghs_mock_token');
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    for (const id of [...createdRepoIds]) {
      try {
        await gitRepositoriesDao.hardDeleteById(id);
      } catch {
        // Already deleted — ignore
      }
    }
    createdRepoIds.length = 0;

    for (const id of [...createdInstallationIds]) {
      try {
        await gitProviderConnectionDao.hardDeleteById(id);
      } catch {
        // Already deleted — ignore
      }
    }
    createdInstallationIds.length = 0;
  });

  afterAll(async () => {
    if (projectCreated) {
      try {
        const dataSource = app.get(DataSource);
        await dataSource.query(`DELETE FROM projects WHERE id = $1`, [TEST_PROJECT_ID]);
      } catch {
        // Ignore
      }
    }
    await app?.close();
  }, 360_000);

  const createInstallation = async (installationId: number, accountLogin: string) => {
    const conn = await gitProviderConnectionDao.create({
      userId: TEST_USER_ID,
      provider: GitProvider.GitHub,
      accountLogin,
      metadata: { installationId, accountType: 'Organization' },
      isActive: true,
    });
    createdInstallationIds.push(conn.id);
    return conn;
  };

  const trackRepo = (id: string) => {
    if (!createdRepoIds.includes(id)) {
      createdRepoIds.push(id);
    }
  };

  describe('happy path: sync upserts repos into DB', () => {
    it('syncs repos from one installation and verifies DB records', async () => {
      const installation = await createInstallation(88001, 'sync-org');

      vi.spyOn(gitHubAppProviderService, 'getActiveInstallations').mockResolvedValue([installation]);
      vi.spyOn(global, 'fetch').mockResolvedValue(
        makeGithubResponse([
          { owner: 'sync-org', name: 'api-service', html_url: 'https://github.com/sync-org/api-service', default_branch: 'main' },
          { owner: 'sync-org', name: 'web-app', html_url: 'https://github.com/sync-org/web-app', default_branch: 'main' },
        ]),
      );

      const result = await gitRepositoriesService.syncRepositories(ctx);

      expect(result.synced).toBe(2);
      expect(result.removed).toBe(0);
      expect(result.total).toBeGreaterThanOrEqual(2);

      // Verify DB records exist with correct shape
      const savedRepos = await gitRepositoriesDao.getAll({
        createdBy: TEST_USER_ID,
        projectId: TEST_PROJECT_ID,
        hasInstallationId: true,
      } );

      const apiService = savedRepos.find((r) => r.repo === 'api-service');
      const webApp = savedRepos.find((r) => r.repo === 'web-app');

      expect(apiService).toBeDefined();
      expect(apiService!.owner).toBe('sync-org');
      expect(apiService!.provider).toBe(GitRepositoryProvider.GITHUB);
      expect(apiService!.installationId).toBe(installation.metadata['installationId']);
      expect(apiService!.createdBy).toBe(TEST_USER_ID);
      expect(apiService!.projectId).toBe(TEST_PROJECT_ID);

      expect(webApp).toBeDefined();
      expect(webApp!.owner).toBe('sync-org');

      for (const r of savedRepos) {
        if (r.owner === 'sync-org') {
          trackRepo(r.id);
        }
      }
    });
  });

  describe('revoked repo soft-deleted when not in GitHub response', () => {
    it('soft-deletes an installation-linked repo that GitHub no longer returns', async () => {
      const installation = await createInstallation(88002, 'revoke-org');

      // Manually insert a repo that "was" previously synced via GitHub App
      const existingRepo = await gitRepositoriesDao.create({
        owner: 'revoke-org',
        repo: 'old-repo',
        url: 'https://github.com/revoke-org/old-repo',
        provider: GitRepositoryProvider.GITHUB,
        defaultBranch: 'main',
        createdBy: TEST_USER_ID,
        projectId: TEST_PROJECT_ID,
        installationId: 88002,
        syncedAt: new Date(),
      });
      trackRepo(existingRepo.id);

      vi.spyOn(gitHubAppProviderService, 'getActiveInstallations').mockResolvedValue([installation]);
      // GitHub returns empty — the existing repo has been revoked
      vi.spyOn(global, 'fetch').mockResolvedValue(makeGithubResponse([]));

      const result = await gitRepositoriesService.syncRepositories(ctx);

      expect(result.removed).toBe(1);

      // Row should be soft-deleted (not visible in default queries)
      const afterSync = await gitRepositoriesDao.getOne({ id: existingRepo.id } );
      expect(afterSync).toBeNull();

      // Confirm deletedAt is set
      const withDeleted = await gitRepositoriesDao.getOne({
        id: existingRepo.id,
        withDeleted: true,
      } );
      expect(withDeleted).not.toBeNull();
      expect(withDeleted!.deletedAt).not.toBeNull();
    });
  });

  describe('manually added repo survives sync unchanged', () => {
    it('does not delete a repo with installationId = null during sync', async () => {
      const installation = await createInstallation(88003, 'pat-test-org');

      // Insert a manually-added repo (no installationId)
      const patRepo = await gitRepositoriesDao.create({
        owner: 'some-personal',
        repo: 'my-private-repo',
        url: 'https://github.com/some-personal/my-private-repo',
        provider: GitRepositoryProvider.GITHUB,
        defaultBranch: 'main',
        createdBy: TEST_USER_ID,
        projectId: TEST_PROJECT_ID,
        installationId: null,
        syncedAt: null,
      });
      trackRepo(patRepo.id);

      vi.spyOn(gitHubAppProviderService, 'getActiveInstallations').mockResolvedValue([installation]);
      // GitHub returns zero repos for the installation
      vi.spyOn(global, 'fetch').mockResolvedValue(makeGithubResponse([]));

      await gitRepositoriesService.syncRepositories(ctx);

      // PAT repo must still exist after sync
      const afterSync = await gitRepositoriesDao.getOne({ id: patRepo.id } );
      expect(afterSync).not.toBeNull();
      expect(afterSync!.id).toBe(patRepo.id);
      expect(afterSync!.installationId).toBeNull();
    });
  });

});
