import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitProviderConnectionDao } from '../dao/git-provider-connection.dao';
import { GitProviderConnectionEntity } from '../entity/git-provider-connection.entity';
import { GitProvider } from '../types/git-provider.enum';
import { INSTALLATION_UNLINKED_EVENT } from '../types/installation-unlinked.event';
import { GitHubAppService } from './github-app.service';
import { GitHubAppProviderService } from './github-app-provider.service';

vi.mock('../../../environments', () => ({
  environment: {
    githubAppId: 'test-app-id',
    githubAppPrivateKey: 'test-private-key',
    githubAppClientId: 'Iv1.test-client-id',
    githubAppClientSecret: 'test-client-secret',
  },
}));

describe('GitHubAppProviderService', () => {
  let service: GitHubAppProviderService;
  let mockGitHubAppService: {
    isConfigured: ReturnType<typeof vi.fn>;
    getAppSlug: ReturnType<typeof vi.fn>;
    getInstallation: ReturnType<typeof vi.fn>;
    getInstallationToken: ReturnType<typeof vi.fn>;
    invalidateCachedToken: ReturnType<typeof vi.fn>;
    exchangeCodeAndGetInstallations: ReturnType<typeof vi.fn>;
    deleteInstallation: ReturnType<typeof vi.fn>;
  };
  let mockConnectionDao: {
    getOne: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateById: ReturnType<typeof vi.fn>;
  };
  let mockLogger: {
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  let mockEventEmitter: {
    emit: ReturnType<typeof vi.fn>;
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
      invalidateCachedToken: vi.fn(),
      exchangeCodeAndGetInstallations: vi.fn().mockResolvedValue([]),
      deleteInstallation: vi.fn().mockResolvedValue(undefined),
    };

    mockConnectionDao = {
      getOne: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      updateById: vi.fn().mockResolvedValue({}),
    };

    mockLogger = { log: vi.fn(), warn: vi.fn() };

    mockEventEmitter = {
      emit: vi.fn(),
    };

    service = new GitHubAppProviderService(
      mockGitHubAppService as unknown as GitHubAppService,
      mockConnectionDao as unknown as GitProviderConnectionDao,
      mockLogger as unknown as DefaultLogger,
      mockEventEmitter as unknown as EventEmitter2,
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
        reconfigureUrlTemplate:
          'https://github.com/settings/installations/{id}',
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

  describe('linkViaOAuthCode', () => {
    it('should throw when no installations found', async () => {
      mockGitHubAppService.exchangeCodeAndGetInstallations.mockResolvedValue(
        [],
      );

      await expect(
        service.linkViaOAuthCode('user-123', 'code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should forward an installation hint to GitHubAppService', async () => {
      mockGitHubAppService.exchangeCodeAndGetInstallations.mockResolvedValue([
        { id: 100, account: { login: 'org-a', type: 'Organization' } },
      ]);

      await service.linkViaOAuthCode('user-123', 'code', 100);

      expect(
        mockGitHubAppService.exchangeCodeAndGetInstallations,
      ).toHaveBeenCalledWith('code', 'user-123', 100);
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
      expect(mockConnectionDao.create).toHaveBeenCalledTimes(2);
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

      expect(mockConnectionDao.create).toHaveBeenCalledTimes(1);
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

      expect(mockConnectionDao.create).not.toHaveBeenCalled();
    });
  });

  describe('listInstallations', () => {
    it('should return user installations from DB without making GitHub API calls', async () => {
      const now = new Date();
      mockConnectionDao.getAll.mockResolvedValue([
        {
          id: 'record-1',
          provider: GitProvider.GitHub,
          accountLogin: 'my-org',
          metadata: { installationId: 12345, accountType: 'Organization' },
          isActive: true,
          createdAt: now,
        } as unknown as GitProviderConnectionEntity,
      ]);

      const result = await service.listInstallations('user-123');

      expect(result.installations).toHaveLength(1);
      expect(result.installations[0]!.accountLogin).toBe('my-org');
      expect(result.installations[0]!.installationId).toBe(12345);
      expect(result.installations[0]!.accountType).toBe('Organization');
      // Should NOT make any GitHub API calls for validation
      expect(mockGitHubAppService.getInstallationToken).not.toHaveBeenCalled();
      expect(mockGitHubAppService.invalidateCachedToken).not.toHaveBeenCalled();
    });

    it('should return all active connections without filtering by token validity', async () => {
      const now = new Date();
      mockConnectionDao.getAll.mockResolvedValue([
        {
          id: 'record-1',
          provider: GitProvider.GitHub,
          accountLogin: 'org-a',
          metadata: { installationId: 111, accountType: 'Organization' },
          isActive: true,
          createdAt: now,
        } as unknown as GitProviderConnectionEntity,
        {
          id: 'record-2',
          provider: GitProvider.GitHub,
          accountLogin: 'org-b',
          metadata: { installationId: 222, accountType: 'Organization' },
          isActive: true,
          createdAt: now,
        } as unknown as GitProviderConnectionEntity,
      ]);

      const result = await service.listInstallations('user-123');

      expect(result.installations).toHaveLength(2);
      expect(result.installations[0]!.accountLogin).toBe('org-a');
      expect(result.installations[1]!.accountLogin).toBe('org-b');
      // No deactivation should happen during list
      expect(mockConnectionDao.updateById).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('getActiveInstallations', () => {
    it('should call DAO with userId, provider, and isActive: true', async () => {
      const mockConnections = [
        {
          id: 'conn-1',
          userId: 'user-123',
          provider: GitProvider.GitHub,
          metadata: { installationId: 100 },
          isActive: true,
        },
      ] as unknown as GitProviderConnectionEntity[];

      mockConnectionDao.getAll.mockResolvedValue(mockConnections);

      const result = await service.getActiveInstallations('user-123');

      expect(mockConnectionDao.getAll).toHaveBeenCalledWith({
        userId: 'user-123',
        provider: GitProvider.GitHub,
        isActive: true,
      });
      expect(result).toBe(mockConnections);
    });

    it('should return empty array when no active connections exist', async () => {
      mockConnectionDao.getAll.mockResolvedValue([]);

      const result = await service.getActiveInstallations('user-no-installs');

      expect(result).toEqual([]);
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
    it('should deactivate locally and emit event without calling GitHub delete', async () => {
      mockConnectionDao.getAll.mockResolvedValue([
        {
          id: 'record-1',
          userId: 'user-123',
          provider: GitProvider.GitHub,
          accountLogin: 'my-org',
          metadata: { installationId: 12345 },
        } as unknown as GitProviderConnectionEntity,
      ]);

      const result = await service.unlinkInstallation('user-123', 12345);

      expect(mockGitHubAppService.deleteInstallation).not.toHaveBeenCalled();
      expect(mockConnectionDao.updateById).toHaveBeenCalledWith('record-1', {
        isActive: false,
      });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        INSTALLATION_UNLINKED_EVENT,
        expect.objectContaining({
          userId: 'user-123',
          provider: GitProvider.GitHub,
          connectionIds: ['record-1'],
          accountLogins: ['my-org'],
          githubInstallationIds: [12345],
        }),
      );
      expect(result).toEqual({ unlinked: true });
    });

    it('should return unlinked: true even when no record found', async () => {
      mockConnectionDao.getAll.mockResolvedValue([]);

      const result = await service.unlinkInstallation('user-123', 12345);

      expect(result).toEqual({ unlinked: true });
      expect(mockConnectionDao.updateById).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should not unlink an installation belonging to a different user', async () => {
      // The DAO is called with user-A's userId, so it returns empty (no connections for user-A)
      mockConnectionDao.getAll.mockResolvedValue([]);

      const result = await service.unlinkInstallation('user-A', 99999);

      // Since getAll returns empty for user-A, no connection matches installationId 99999
      expect(mockConnectionDao.updateById).not.toHaveBeenCalled();
      expect(mockGitHubAppService.deleteInstallation).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('deactivateByInstallationId', () => {
    it('should deactivate connection and emit event without calling GitHub delete', async () => {
      mockConnectionDao.getAll.mockResolvedValue([
        {
          id: 'record-1',
          userId: 'user-123',
          provider: GitProvider.GitHub,
          accountLogin: 'my-org',
          metadata: { installationId: 12345 },
        } as unknown as GitProviderConnectionEntity,
      ]);

      await service.deactivateByInstallationId('user-123', 12345);

      expect(mockGitHubAppService.deleteInstallation).not.toHaveBeenCalled();
      expect(mockConnectionDao.updateById).toHaveBeenCalledWith('record-1', {
        isActive: false,
      });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        INSTALLATION_UNLINKED_EVENT,
        expect.objectContaining({
          userId: 'user-123',
          provider: GitProvider.GitHub,
          connectionIds: ['record-1'],
          accountLogins: ['my-org'],
          githubInstallationIds: [12345],
        }),
      );
    });

    it('should do nothing when no matching connection is found', async () => {
      mockConnectionDao.getAll.mockResolvedValue([]);

      await service.deactivateByInstallationId('user-123', 99999);

      expect(mockConnectionDao.updateById).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should not match connections belonging to a different user', async () => {
      mockConnectionDao.getAll.mockResolvedValue([]);

      await service.deactivateByInstallationId('user-other', 12345);

      expect(mockConnectionDao.updateById).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('disconnectAll', () => {
    it('should deactivate all connections locally and emit event without calling GitHub delete', async () => {
      mockConnectionDao.getAll.mockResolvedValue([
        { id: 'r1', accountLogin: 'org-a', metadata: { installationId: 100 } },
        { id: 'r2', accountLogin: 'org-b', metadata: { installationId: 200 } },
      ]);

      const result = await service.disconnectAll('user-123');

      expect(mockGitHubAppService.deleteInstallation).not.toHaveBeenCalled();
      expect(mockConnectionDao.updateById).toHaveBeenCalledTimes(2);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        INSTALLATION_UNLINKED_EVENT,
        expect.objectContaining({
          userId: 'user-123',
          provider: GitProvider.GitHub,
          connectionIds: ['r1', 'r2'],
          accountLogins: ['org-a', 'org-b'],
          githubInstallationIds: [100, 200],
        }),
      );
      expect(result).toEqual({ unlinked: true });
    });

    it('should not emit event when no active connections exist', async () => {
      mockConnectionDao.getAll.mockResolvedValue([]);

      const result = await service.disconnectAll('user-123');

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      expect(result).toEqual({ unlinked: true });
    });
  });
});
