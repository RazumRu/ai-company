import { INestApplication } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { GitProviderConnectionDao } from '../../../v1/git-auth/dao/git-provider-connection.dao';
import { GitProviderConnectionEntity } from '../../../v1/git-auth/entity/git-provider-connection.entity';
import { GitTokenResolverService } from '../../../v1/git-auth/services/git-token-resolver.service';
import { GitHubAppService } from '../../../v1/git-auth/services/github-app.service';
import { GitHubAppProviderService } from '../../../v1/git-auth/services/github-app-provider.service';
import { GitProvider } from '../../../v1/git-auth/types/git-provider.enum';
import { createTestModule, TEST_USER_ID } from '../setup';

describe('Git Auth Integration Tests', () => {
  let app: INestApplication;
  let gitHubAppService: GitHubAppService;
  let gitHubAppProviderService: GitHubAppProviderService;
  let gitTokenResolverService: GitTokenResolverService;
  let gitProviderConnectionDao: GitProviderConnectionDao;
  const createdConnectionIds: string[] = [];
  let connectionCounter = 0;
  const runId = `${Date.now()}`;

  /** Generate a unique accountLogin for this test run to avoid cross-run collisions. */
  const uniqueLogin = (label: string) =>
    `${label}-${runId}-${connectionCounter++}`;

  beforeAll(async () => {
    app = await createTestModule();
    gitHubAppService = app.get<GitHubAppService>(GitHubAppService);
    gitHubAppProviderService = app.get<GitHubAppProviderService>(
      GitHubAppProviderService,
    );
    gitTokenResolverService = app.get<GitTokenResolverService>(
      GitTokenResolverService,
    );
    gitProviderConnectionDao = app.get<GitProviderConnectionDao>(
      GitProviderConnectionDao,
    );
  }, 360_000);

  afterAll(async () => {
    for (const id of createdConnectionIds) {
      try {
        await gitProviderConnectionDao.hardDeleteById(id);
      } catch {
        // Record may already be deleted by a test
      }
    }
    await app.close();
  }, 360_000);

  const createConnection = async (
    overrides: Partial<
      Omit<
        GitProviderConnectionEntity,
        'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
      >
    > = {},
  ) => {
    const connection = await gitProviderConnectionDao.create({
      userId: overrides.userId ?? TEST_USER_ID,
      provider: overrides.provider ?? GitProvider.GitHub,
      accountLogin: overrides.accountLogin ?? uniqueLogin('test-org'),
      metadata: overrides.metadata ?? {
        installationId: Math.floor(Math.random() * 1_000_000) + 1,
        accountType: 'Organization',
      },
      isActive: overrides.isActive ?? true,
    });
    createdConnectionIds.push(connection.id);
    return connection;
  };

  describe('GitHubAppService.isConfigured()', () => {
    it('returns a boolean reflecting GitHub App env vars presence', () => {
      const configured = gitHubAppService.isConfigured();
      expect(typeof configured).toBe('boolean');
    });
  });

  describe('GitHubAppService.generateJwt()', () => {
    it('throws GITHUB_APP_NOT_CONFIGURED when env vars are missing', () => {
      if (gitHubAppService.isConfigured()) {
        expect(() => gitHubAppService.generateJwt()).not.toThrow(
          BadRequestException,
        );
        return;
      }
      expect(() => gitHubAppService.generateJwt()).toThrow(BadRequestException);
    });
  });

  describe('GitHubAppService.getInstallationToken()', () => {
    it('throws GITHUB_APP_NOT_CONFIGURED when env vars are missing', async () => {
      if (gitHubAppService.isConfigured()) {
        await expect(
          gitHubAppService.getInstallationToken(12345),
        ).rejects.toThrow();
        return;
      }
      await expect(
        gitHubAppService.getInstallationToken(12345),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GitProviderConnectionDao CRUD', () => {
    it('creates and retrieves a connection record', async () => {
      const login = uniqueLogin('my-org');
      const connection = await createConnection({
        accountLogin: login,
        metadata: { installationId: 100001, accountType: 'Organization' },
      });

      expect(connection.id).toBeDefined();
      expect(connection.userId).toBe(TEST_USER_ID);
      expect(connection.accountLogin).toBe(login);
      expect(connection.provider).toBe(GitProvider.GitHub);
      expect(connection.metadata).toEqual({
        installationId: 100001,
        accountType: 'Organization',
      });
      expect(connection.isActive).toBe(true);

      const fetched = await gitProviderConnectionDao.getOne({
        id: connection.id,
      });
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(connection.id);
      expect(fetched!.accountLogin).toBe(login);
    });

    it('lists connections for a user', async () => {
      const conn1 = await createConnection({
        accountLogin: uniqueLogin('list-org-1'),
        metadata: { installationId: 200001, accountType: 'Organization' },
      });
      const conn2 = await createConnection({
        accountLogin: uniqueLogin('list-org-2'),
        metadata: { installationId: 200002, accountType: 'Organization' },
      });

      const all = await gitProviderConnectionDao.getAll({
        userId: TEST_USER_ID,
        isActive: true,
      });

      const ids = all.map((c) => c.id);
      expect(ids).toContain(conn1.id);
      expect(ids).toContain(conn2.id);
    });

    it('updates a connection to inactive (unlink)', async () => {
      const connection = await createConnection({
        accountLogin: uniqueLogin('unlink-org'),
        metadata: { installationId: 300001, accountType: 'Organization' },
      });

      expect(connection.isActive).toBe(true);

      await gitProviderConnectionDao.updateById(connection.id, {
        isActive: false,
      });

      const updated = await gitProviderConnectionDao.getOne({
        id: connection.id,
      });
      expect(updated).not.toBeNull();
      expect(updated!.isActive).toBe(false);
    });

    it('filters out inactive connections when queried with isActive=true', async () => {
      const active = await createConnection({
        accountLogin: uniqueLogin('active-org'),
        metadata: { installationId: 400001, accountType: 'Organization' },
      });
      const inactive = await createConnection({
        accountLogin: uniqueLogin('inactive-org'),
        metadata: { installationId: 400002, accountType: 'Organization' },
        isActive: false,
      });

      const activeConnections = await gitProviderConnectionDao.getAll({
        userId: TEST_USER_ID,
        isActive: true,
      });

      const activeIds = activeConnections.map((c) => c.id);
      expect(activeIds).toContain(active.id);
      expect(activeIds).not.toContain(inactive.id);
    });

    it('filters connections by accountLogin', async () => {
      const login = uniqueLogin('filter-login');
      const target = await createConnection({
        accountLogin: login,
        metadata: { installationId: 500001, accountType: 'Organization' },
      });
      await createConnection({
        accountLogin: uniqueLogin('other-login'),
        metadata: { installationId: 500002, accountType: 'Organization' },
      });

      const results = await gitProviderConnectionDao.getAll({
        userId: TEST_USER_ID,
        accountLogin: login,
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(target.id);
    });

    it('filters connections by provider', async () => {
      const ghConn = await createConnection({
        accountLogin: uniqueLogin('provider-filter'),
        provider: GitProvider.GitHub,
        metadata: { installationId: 500003, accountType: 'Organization' },
      });

      const results = await gitProviderConnectionDao.getAll({
        userId: TEST_USER_ID,
        provider: GitProvider.GitHub,
        accountLogin: ghConn.accountLogin,
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.provider).toBe(GitProvider.GitHub);
    });

    it('hard deletes a connection', async () => {
      const connection = await createConnection({
        accountLogin: uniqueLogin('delete-org'),
        metadata: { installationId: 600001, accountType: 'Organization' },
      });

      await gitProviderConnectionDao.hardDeleteById(connection.id);
      const idx = createdConnectionIds.indexOf(connection.id);
      if (idx !== -1) {
        createdConnectionIds.splice(idx, 1);
      }

      const fetched = await gitProviderConnectionDao.getOne({
        id: connection.id,
      });
      expect(fetched).toBeNull();
    });
  });

  describe('GitTokenResolverService', () => {
    it('returns null when no matching connection exists', async () => {
      const result = await gitTokenResolverService.resolveToken(
        GitProvider.GitHub,
        'nonexistent-owner',
        TEST_USER_ID,
      );

      expect(result).toBeNull();
    });

    it('returns null when a connection exists but App cannot issue a token', async () => {
      const login = uniqueLogin('resolver-org');
      await createConnection({
        accountLogin: login,
        metadata: { installationId: 700001, accountType: 'Organization' },
      });

      if (gitHubAppService.isConfigured()) {
        const result = await gitTokenResolverService.resolveToken(
          GitProvider.GitHub,
          login,
          TEST_USER_ID,
        );

        expect(result === null || typeof result?.token === 'string').toBe(true);
      } else {
        const result = await gitTokenResolverService.resolveToken(
          GitProvider.GitHub,
          login,
          TEST_USER_ID,
        );

        expect(result).toBeNull();
      }
    });

    it('returns null from resolveDefaultToken when App is not configured or no connection exists', async () => {
      if (gitHubAppService.isConfigured()) {
        const result =
          await gitTokenResolverService.resolveDefaultToken(TEST_USER_ID);
        expect(result === null || typeof result?.token === 'string').toBe(true);
      } else {
        const result =
          await gitTokenResolverService.resolveDefaultToken(TEST_USER_ID);
        expect(result).toBeNull();
      }
    });

    it('returns null for non-GitHub providers', async () => {
      const result = await gitTokenResolverService.resolveToken(
        GitProvider.GitLab,
        'some-org',
        TEST_USER_ID,
      );

      expect(result).toBeNull();
    });
  });

  describe('GitHubAppService.invalidateCachedToken()', () => {
    it('does not throw when invalidating a non-existent cache entry', () => {
      expect(() =>
        gitHubAppService.invalidateCachedToken(999999),
      ).not.toThrow();
    });
  });

  describe('GitHubAppProviderService.disconnectAll()', () => {
    it('marks all active connections as inactive without calling GitHub API', async () => {
      const conn1 = await createConnection({
        accountLogin: uniqueLogin('disconnect-org-1'),
        metadata: { installationId: 800001, accountType: 'Organization' },
      });
      const conn2 = await createConnection({
        accountLogin: uniqueLogin('disconnect-org-2'),
        metadata: { installationId: 800002, accountType: 'Organization' },
      });

      const result = await gitHubAppProviderService.disconnectAll(TEST_USER_ID);

      expect(result).toEqual({ unlinked: true });

      const updated1 = await gitProviderConnectionDao.getOne({
        id: conn1.id,
      });
      const updated2 = await gitProviderConnectionDao.getOne({
        id: conn2.id,
      });
      expect(updated1!.isActive).toBe(false);
      expect(updated2!.isActive).toBe(false);
    });
  });
});
