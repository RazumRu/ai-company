import { INestApplication } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GitHubAppInstallationDao } from '../../../v1/github-app/dao/github-app-installation.dao';
import { GitHubAppInstallationEntity } from '../../../v1/github-app/entity/github-app-installation.entity';
import { GitHubAppService } from '../../../v1/github-app/services/github-app.service';
import { GitHubTokenResolverService } from '../../../v1/github-app/services/github-token-resolver.service';
import { GitHubAuthMethod } from '../../../v1/graph-resources/graph-resources.types';
import { createTestModule, TEST_USER_ID } from '../setup';

describe('GitHub App Integration Tests', () => {
  let app: INestApplication;
  let gitHubAppService: GitHubAppService;
  let gitHubTokenResolverService: GitHubTokenResolverService;
  let gitHubAppInstallationDao: GitHubAppInstallationDao;
  const createdInstallationIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    gitHubAppService = app.get<GitHubAppService>(GitHubAppService);
    gitHubTokenResolverService = app.get<GitHubTokenResolverService>(
      GitHubTokenResolverService,
    );
    gitHubAppInstallationDao = app.get<GitHubAppInstallationDao>(
      GitHubAppInstallationDao,
    );
  }, 360_000);

  afterAll(async () => {
    for (const id of createdInstallationIds) {
      try {
        await gitHubAppInstallationDao.hardDeleteById(id);
      } catch {
        // Record may already be deleted by a test
      }
    }
    await app.close();
  }, 360_000);

  const createInstallation = async (
    overrides: Partial<
      Omit<
        GitHubAppInstallationEntity,
        'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
      >
    > = {},
  ) => {
    const installation = await gitHubAppInstallationDao.create({
      userId: overrides.userId ?? TEST_USER_ID,
      installationId:
        overrides.installationId ?? Math.floor(Math.random() * 1_000_000) + 1,
      accountLogin: overrides.accountLogin ?? `test-org-${Date.now()}`,
      accountType: overrides.accountType ?? 'Organization',
      isActive: overrides.isActive ?? true,
    });
    createdInstallationIds.push(installation.id);
    return installation;
  };

  describe('GitHubAppService.isConfigured()', () => {
    it('returns false when GitHub App env vars are not set', () => {
      // In the test environment, GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are not set
      expect(gitHubAppService.isConfigured()).toBe(false);
    });
  });

  describe('GitHubAppService.generateJwt()', () => {
    it('throws GITHUB_APP_NOT_CONFIGURED when env vars are missing', () => {
      expect(() => gitHubAppService.generateJwt()).toThrow(BadRequestException);
    });
  });

  describe('GitHubAppService.getInstallationToken()', () => {
    it('throws GITHUB_APP_NOT_CONFIGURED when env vars are missing', async () => {
      await expect(
        gitHubAppService.getInstallationToken(12345),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GitHubAppInstallationDao CRUD', () => {
    it('creates and retrieves an installation record', async () => {
      const installation = await createInstallation({
        accountLogin: 'my-org',
        accountType: 'Organization',
        installationId: 100001,
      });

      expect(installation.id).toBeDefined();
      expect(installation.userId).toBe(TEST_USER_ID);
      expect(installation.accountLogin).toBe('my-org');
      expect(installation.accountType).toBe('Organization');
      expect(installation.installationId).toBe(100001);
      expect(installation.isActive).toBe(true);

      const fetched = await gitHubAppInstallationDao.getOne({
        id: installation.id,
      });
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(installation.id);
      expect(fetched!.accountLogin).toBe('my-org');
    });

    it('lists installations for a user', async () => {
      const inst1 = await createInstallation({
        accountLogin: 'list-org-1',
        installationId: 200001,
      });
      const inst2 = await createInstallation({
        accountLogin: 'list-org-2',
        installationId: 200002,
      });

      const all = await gitHubAppInstallationDao.getAll({
        userId: TEST_USER_ID,
        isActive: true,
      });

      const ids = all.map((i) => i.id);
      expect(ids).toContain(inst1.id);
      expect(ids).toContain(inst2.id);
    });

    it('updates an installation to inactive (unlink)', async () => {
      const installation = await createInstallation({
        accountLogin: 'unlink-org',
        installationId: 300001,
      });

      expect(installation.isActive).toBe(true);

      await gitHubAppInstallationDao.updateById(installation.id, {
        isActive: false,
      });

      const updated = await gitHubAppInstallationDao.getOne({
        id: installation.id,
      });
      expect(updated).not.toBeNull();
      expect(updated!.isActive).toBe(false);
    });

    it('filters out inactive installations when queried with isActive=true', async () => {
      const active = await createInstallation({
        accountLogin: 'active-org',
        installationId: 400001,
      });
      const inactive = await createInstallation({
        accountLogin: 'inactive-org',
        installationId: 400002,
        isActive: false,
      });

      const activeInstallations = await gitHubAppInstallationDao.getAll({
        userId: TEST_USER_ID,
        isActive: true,
      });

      const activeIds = activeInstallations.map((i) => i.id);
      expect(activeIds).toContain(active.id);
      expect(activeIds).not.toContain(inactive.id);
    });

    it('filters installations by accountLogin', async () => {
      const uniqueLogin = `filter-login-${Date.now()}`;
      const target = await createInstallation({
        accountLogin: uniqueLogin,
        installationId: 500001,
      });
      await createInstallation({
        accountLogin: 'other-login',
        installationId: 500002,
      });

      const results = await gitHubAppInstallationDao.getAll({
        userId: TEST_USER_ID,
        accountLogin: uniqueLogin,
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(target.id);
    });

    it('hard deletes an installation', async () => {
      const installation = await createInstallation({
        accountLogin: 'delete-org',
        installationId: 600001,
      });

      await gitHubAppInstallationDao.hardDeleteById(installation.id);
      // Remove from cleanup list since we already deleted it
      const idx = createdInstallationIds.indexOf(installation.id);
      if (idx !== -1) createdInstallationIds.splice(idx, 1);

      const fetched = await gitHubAppInstallationDao.getOne({
        id: installation.id,
      });
      expect(fetched).toBeNull();
    });
  });

  describe('GitHubTokenResolverService', () => {
    it('returns PAT with source "pat" when no App installation exists', async () => {
      const result = await gitHubTokenResolverService.resolveTokenForOwner(
        'nonexistent-owner',
        TEST_USER_ID,
        'ghp_testpat123',
      );

      expect(result).not.toBeNull();
      expect(result!.token).toBe('ghp_testpat123');
      expect(result!.source).toBe(GitHubAuthMethod.Pat);
    });

    it('returns null when no PAT and no matching installation', async () => {
      const result = await gitHubTokenResolverService.resolveTokenForOwner(
        'nonexistent-owner',
        TEST_USER_ID,
      );

      expect(result).toBeNull();
    });

    it('returns null when no PAT and undefined is passed', async () => {
      const result = await gitHubTokenResolverService.resolveTokenForOwner(
        'no-match-owner',
        TEST_USER_ID,
        undefined,
      );

      expect(result).toBeNull();
    });

    it('falls back to PAT even when an installation exists but App is not configured', async () => {
      // Create an installation record in the DB
      await createInstallation({
        accountLogin: 'resolver-org',
        installationId: 700001,
      });

      // Since the GitHub App is not configured (isConfigured() returns false),
      // the resolver skips the App token path entirely and falls back to PAT
      const result = await gitHubTokenResolverService.resolveTokenForOwner(
        'resolver-org',
        TEST_USER_ID,
        'ghp_fallback_pat',
      );

      expect(result).not.toBeNull();
      expect(result!.token).toBe('ghp_fallback_pat');
      expect(result!.source).toBe(GitHubAuthMethod.Pat);
    });

    it('returns null from resolveDefaultToken when App is not configured', async () => {
      const result =
        await gitHubTokenResolverService.resolveDefaultToken(TEST_USER_ID);

      expect(result).toBeNull();
    });
  });

  describe('GitHubAppService.invalidateCachedToken()', () => {
    it('does not throw when invalidating a non-existent cache entry', () => {
      // This should be a no-op without errors
      expect(() =>
        gitHubAppService.invalidateCachedToken(999999),
      ).not.toThrow();
    });
  });
});
