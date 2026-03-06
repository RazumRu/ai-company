import { BadRequestException, DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitRepositoriesService } from '../../git-repositories/services/git-repositories.service';
import { GitHubAppInstallationDao } from '../dao/github-app-installation.dao';
import { GitHubAppInstallationEntity } from '../entity/github-app-installation.entity';
import { GitHubAppInstallationService } from './github-app-installation.service';
import { GitHubAppService } from './github-app.service';

vi.mock('../../../environments', () => ({
  environment: {
    githubAppId: 'test-app-id',
    githubAppPrivateKey: 'test-private-key',
    githubAppClientId: 'Iv1.test-client-id',
    githubAppClientSecret: 'test-client-secret',
  },
}));

describe('GitHubAppInstallationService', () => {
  let service: GitHubAppInstallationService;
  let mockGitHubAppService: {
    isConfigured: ReturnType<typeof vi.fn>;
    getAppSlug: ReturnType<typeof vi.fn>;
    getInstallation: ReturnType<typeof vi.fn>;
    getInstallationToken: ReturnType<typeof vi.fn>;
    exchangeCodeAndGetInstallations: ReturnType<typeof vi.fn>;
    deleteInstallation: ReturnType<typeof vi.fn>;
  };
  let mockInstallationDao: {
    getOne: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateById: ReturnType<typeof vi.fn>;
  };
  let mockLogger: { warn: ReturnType<typeof vi.fn> };
  let mockGitRepositoriesService: {
    deleteRepositoriesByInstallationIds: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockGitHubAppService = {
      isConfigured: vi.fn().mockReturnValue(true),
      getAppSlug: vi.fn().mockResolvedValue('my-github-app'),
      getInstallation: vi.fn().mockResolvedValue({
        id: 12345,
        account: { login: 'my-org', type: 'Organization' },
      }),
      getInstallationToken: vi.fn().mockResolvedValue('ghs_test_token'),
      exchangeCodeAndGetInstallations: vi.fn().mockResolvedValue([]),
      deleteInstallation: vi.fn().mockResolvedValue(undefined),
    };

    mockInstallationDao = {
      getOne: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      updateById: vi.fn().mockResolvedValue({}),
    };

    mockLogger = { warn: vi.fn() };

    mockGitRepositoriesService = {
      deleteRepositoriesByInstallationIds: vi.fn().mockResolvedValue(0),
    };

    service = new GitHubAppInstallationService(
      mockGitHubAppService as unknown as GitHubAppService,
      mockInstallationDao as unknown as GitHubAppInstallationDao,
      mockLogger as unknown as DefaultLogger,
      mockGitRepositoriesService as unknown as GitRepositoriesService,
    );
  });

  describe('getSetupInfo', () => {
    it('should return OAuth install URL and newInstallationUrl when configured', async () => {
      const result = await service.getSetupInfo();

      expect(result).toEqual({
        installUrl:
          'https://github.com/login/oauth/authorize?client_id=Iv1.test-client-id',
        newInstallationUrl:
          'https://github.com/apps/my-github-app/installations/new',
        configured: true,
        callbackPath: '/github-app/callback',
      });
      expect(mockGitHubAppService.getAppSlug).toHaveBeenCalled();
    });

    it('should return configured:false when isConfigured returns false', async () => {
      mockGitHubAppService.isConfigured.mockReturnValue(false);
      const result = await service.getSetupInfo();

      expect(result.configured).toBe(false);
      expect(result.newInstallationUrl).toBe('');
      expect(mockGitHubAppService.getAppSlug).not.toHaveBeenCalled();
    });

    it('should return empty newInstallationUrl when getAppSlug returns null', async () => {
      mockGitHubAppService.getAppSlug.mockResolvedValue(null);
      const result = await service.getSetupInfo();

      expect(result.configured).toBe(true);
      expect(result.newInstallationUrl).toBe('');
    });
  });

  describe('linkInstallation', () => {
    it('should verify installation and create a new link record', async () => {
      const result = await service.linkInstallation('user-123', 12345);

      expect(mockGitHubAppService.getInstallation).toHaveBeenCalledWith(12345);
      expect(mockGitHubAppService.getInstallationToken).toHaveBeenCalledWith(
        12345,
      );
      expect(mockInstallationDao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          installationId: 12345,
          accountLogin: 'my-org',
          accountType: 'Organization',
          isActive: true,
        }),
      );
      expect(result).toEqual({
        linked: true,
        accountLogin: 'my-org',
        accountType: 'Organization',
      });
    });

    it('should update existing record if already linked', async () => {
      mockInstallationDao.getOne.mockResolvedValue({
        id: 'existing-record',
        userId: 'user-123',
        installationId: 12345,
      } as GitHubAppInstallationEntity);

      const result = await service.linkInstallation('user-123', 12345);

      expect(mockInstallationDao.updateById).toHaveBeenCalledWith(
        'existing-record',
        expect.objectContaining({
          accountLogin: 'my-org',
          accountType: 'Organization',
          isActive: true,
        }),
      );
      expect(mockInstallationDao.create).not.toHaveBeenCalled();
      expect(result.linked).toBe(true);
    });

    it('should reject invalid installation ID', async () => {
      await expect(
        service.linkInstallation('user-123', -1),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('linkViaOAuthCode', () => {
    it('should throw when no installations found', async () => {
      mockGitHubAppService.exchangeCodeAndGetInstallations.mockResolvedValue(
        [],
      );

      await expect(
        service.linkViaOAuthCode('user-123', 'code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should link all accessible installations', async () => {
      mockGitHubAppService.exchangeCodeAndGetInstallations.mockResolvedValue([
        { id: 100, account: { login: 'org-a', type: 'Organization' } },
        { id: 200, account: { login: 'user-b', type: 'User' } },
      ]);

      const result = await service.linkViaOAuthCode('user-123', 'code');

      expect(mockGitHubAppService.getInstallationToken).toHaveBeenCalledTimes(
        2,
      );
      expect(mockGitHubAppService.getInstallationToken).toHaveBeenCalledWith(
        100,
      );
      expect(mockGitHubAppService.getInstallationToken).toHaveBeenCalledWith(
        200,
      );
      expect(mockInstallationDao.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        linked: true,
        accountLogin: 'org-a',
        accountType: 'Organization',
      });
    });

    it('should return the first successfully linked account, not list[0]', async () => {
      mockGitHubAppService.exchangeCodeAndGetInstallations.mockResolvedValue([
        { id: 100, account: { login: 'suspended-org', type: 'Organization' } },
        { id: 200, account: { login: 'good-org', type: 'Organization' } },
      ]);
      // First installation fails token generation, second succeeds
      mockGitHubAppService.getInstallationToken
        .mockRejectedValueOnce(new Error('suspended'))
        .mockResolvedValueOnce('ghs_token');

      const result = await service.linkViaOAuthCode('user-123', 'code');

      expect(mockInstallationDao.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        linked: true,
        accountLogin: 'good-org',
        accountType: 'Organization',
      });
    });

    it('should throw NO_ACCESSIBLE_INSTALLATIONS when all installations fail token generation', async () => {
      mockGitHubAppService.exchangeCodeAndGetInstallations.mockResolvedValue([
        { id: 100, account: { login: 'org-a', type: 'Organization' } },
        { id: 200, account: { login: 'user-b', type: 'User' } },
      ]);
      mockGitHubAppService.getInstallationToken.mockRejectedValue(
        new BadRequestException('GITHUB_APP_TOKEN_GENERATION_FAILED'),
      );

      await expect(
        service.linkViaOAuthCode('user-123', 'code'),
      ).rejects.toThrow(BadRequestException);

      expect(mockInstallationDao.create).not.toHaveBeenCalled();
    });
  });

  describe('listInstallations', () => {
    it('should return user installations', async () => {
      const now = new Date();
      mockInstallationDao.getAll.mockResolvedValue([
        {
          id: 'record-1',
          installationId: 12345,
          accountLogin: 'my-org',
          accountType: 'Organization',
          isActive: true,
          createdAt: now,
        } as GitHubAppInstallationEntity,
      ]);

      const result = await service.listInstallations('user-123');

      expect(result.installations).toHaveLength(1);
      expect(result.installations[0]!.accountLogin).toBe('my-org');
      expect(mockInstallationDao.getAll).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          isActive: true,
        }),
      );
    });
  });

  describe('getActiveInstallations', () => {
    it('should call DAO with userId and isActive: true', async () => {
      const mockInstallations = [
        {
          id: 'inst-1',
          userId: 'user-123',
          installationId: 100,
          isActive: true,
        },
      ] as GitHubAppInstallationEntity[];

      mockInstallationDao.getAll.mockResolvedValue(mockInstallations);

      const result = await service.getActiveInstallations('user-123');

      expect(mockInstallationDao.getAll).toHaveBeenCalledWith({
        userId: 'user-123',
        isActive: true,
      });
      expect(result).toBe(mockInstallations);
    });

    it('should return empty array when no active installations exist', async () => {
      mockInstallationDao.getAll.mockResolvedValue([]);

      const result = await service.getActiveInstallations('user-no-installs');

      expect(result).toEqual([]);
    });
  });

  describe('getInstallationToken', () => {
    it('should delegate to gitHubAppService.getInstallationToken', async () => {
      mockGitHubAppService.getInstallationToken.mockResolvedValue(
        'ghs_delegated_token',
      );

      const result = await service.getInstallationToken(12345);

      expect(mockGitHubAppService.getInstallationToken).toHaveBeenCalledWith(
        12345,
      );
      expect(result).toBe('ghs_delegated_token');
    });

    it('should propagate errors from gitHubAppService', async () => {
      mockGitHubAppService.getInstallationToken.mockRejectedValue(
        new Error('Token generation failed'),
      );

      await expect(service.getInstallationToken(99999)).rejects.toThrow(
        'Token generation failed',
      );
    });
  });

  describe('isConfigured', () => {
    it('should return true when gitHubAppService is configured', () => {
      mockGitHubAppService.isConfigured.mockReturnValue(true);

      expect(service.isConfigured()).toBe(true);
      expect(mockGitHubAppService.isConfigured).toHaveBeenCalled();
    });

    it('should return false when gitHubAppService is not configured', () => {
      mockGitHubAppService.isConfigured.mockReturnValue(false);

      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('unlinkInstallation', () => {
    it('should delete from GitHub and deactivate locally', async () => {
      mockInstallationDao.getOne.mockResolvedValue({
        id: 'record-1',
        userId: 'user-123',
        installationId: 12345,
      } as GitHubAppInstallationEntity);

      const result = await service.unlinkInstallation('user-123', 12345);

      expect(mockGitHubAppService.deleteInstallation).toHaveBeenCalledWith(
        12345,
      );
      expect(mockInstallationDao.updateById).toHaveBeenCalledWith('record-1', {
        isActive: false,
      });
      expect(mockGitRepositoriesService.deleteRepositoriesByInstallationIds).toHaveBeenCalledWith(
        'user-123',
        [12345],
      );
      expect(result).toEqual({ unlinked: true });
    });

    it('should still deactivate locally if GitHub deletion fails', async () => {
      mockInstallationDao.getOne.mockResolvedValue({
        id: 'record-1',
        userId: 'user-123',
        installationId: 12345,
      } as GitHubAppInstallationEntity);
      mockGitHubAppService.deleteInstallation.mockRejectedValue(
        new Error('GitHub API error'),
      );

      const result = await service.unlinkInstallation('user-123', 12345);

      expect(mockInstallationDao.updateById).toHaveBeenCalledWith('record-1', {
        isActive: false,
      });
      expect(mockGitRepositoriesService.deleteRepositoriesByInstallationIds).toHaveBeenCalledWith(
        'user-123',
        [12345],
      );
      expect(result).toEqual({ unlinked: true });
    });

    it('should return unlinked: true even when no record found', async () => {
      const result = await service.unlinkInstallation('user-123', 12345);

      expect(result).toEqual({ unlinked: true });
      expect(mockInstallationDao.updateById).not.toHaveBeenCalled();
      expect(mockGitRepositoriesService.deleteRepositoriesByInstallationIds).not.toHaveBeenCalled();
    });

    it('should reject invalid installation ID', async () => {
      await expect(
        service.unlinkInstallation('user-123', -1),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('disconnectAll', () => {
    it('should delete all installations from GitHub and deactivate locally', async () => {
      mockInstallationDao.getAll.mockResolvedValue([
        { id: 'r1', installationId: 100 },
        { id: 'r2', installationId: 200 },
      ]);

      const result = await service.disconnectAll('user-123');

      expect(mockGitHubAppService.deleteInstallation).toHaveBeenCalledTimes(2);
      expect(mockInstallationDao.updateById).toHaveBeenCalledTimes(2);
      expect(mockGitRepositoriesService.deleteRepositoriesByInstallationIds).toHaveBeenCalledWith(
        'user-123',
        [100, 200],
      );
      expect(result).toEqual({ unlinked: true });
    });

    it('should continue even if some GitHub deletions fail', async () => {
      mockInstallationDao.getAll.mockResolvedValue([
        { id: 'r1', installationId: 100 },
        { id: 'r2', installationId: 200 },
      ]);
      mockGitHubAppService.deleteInstallation
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(undefined);

      const result = await service.disconnectAll('user-123');

      expect(mockInstallationDao.updateById).toHaveBeenCalledTimes(2);
      expect(mockGitRepositoriesService.deleteRepositoriesByInstallationIds).toHaveBeenCalledWith(
        'user-123',
        [100, 200],
      );
      expect(result).toEqual({ unlinked: true });
    });

    it('should not call repo cleanup when no active installations exist', async () => {
      mockInstallationDao.getAll.mockResolvedValue([]);

      const result = await service.disconnectAll('user-123');

      expect(mockGitRepositoriesService.deleteRepositoriesByInstallationIds).toHaveBeenCalledWith(
        'user-123',
        [],
      );
      expect(result).toEqual({ unlinked: true });
    });
  });
});
