import { BadRequestException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubAppInstallationDao } from '../dao/github-app-installation.dao';
import { GitHubAppInstallationEntity } from '../entity/github-app-installation.entity';
import { GitHubAppService } from '../services/github-app.service';
import { GitHubAppController } from './github-app.controller';

vi.mock('../../../environments', () => ({
  environment: {
    githubAppId: 'test-app-id',
    githubAppPrivateKey: 'test-private-key',
    githubAppClientId: 'Iv1.test-client-id',
    githubAppClientSecret: 'test-client-secret',
  },
}));

describe('GitHubAppController', () => {
  let controller: GitHubAppController;
  let mockGitHubAppService: {
    isConfigured: ReturnType<typeof vi.fn>;
    getInstallation: ReturnType<typeof vi.fn>;
    getInstallationToken: ReturnType<typeof vi.fn>;
  };
  let mockInstallationDao: {
    getOne: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateById: ReturnType<typeof vi.fn>;
  };
  let mockCtx: { checkSub: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockGitHubAppService = {
      isConfigured: vi.fn().mockReturnValue(true),
      getInstallation: vi.fn().mockResolvedValue({
        id: 12345,
        account: { login: 'my-org', type: 'Organization' },
      }),
      getInstallationToken: vi.fn().mockResolvedValue('ghs_test_token'),
    };

    mockInstallationDao = {
      getOne: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      updateById: vi.fn().mockResolvedValue({}),
    };

    mockCtx = {
      checkSub: vi.fn().mockReturnValue('user-123'),
    };

    // Instantiate directly to avoid NestJS guard resolution issues in unit tests
    controller = new GitHubAppController(
      mockGitHubAppService as unknown as GitHubAppService,
      mockInstallationDao as unknown as GitHubAppInstallationDao,
    );
  });

  describe('getSetupInfo', () => {
    it('should return OAuth install URL when clientId and app are configured', () => {
      const result = controller.getSetupInfo();

      expect(result).toEqual({
        installUrl:
          'https://github.com/login/oauth/authorize?client_id=Iv1.test-client-id',
        configured: true,
        callbackPath: '/github-app/callback',
      });
    });

    it('should return configured:false when isConfigured returns false', () => {
      mockGitHubAppService.isConfigured.mockReturnValue(false);
      const result = controller.getSetupInfo();

      expect(result.configured).toBe(false);
    });
  });

  describe('linkInstallation', () => {
    it('should verify installation and create a new link record', async () => {
      const result = await controller.linkInstallation('12345', mockCtx as any);

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

      const result = await controller.linkInstallation('12345', mockCtx as any);

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
        controller.linkInstallation('invalid', mockCtx as any),
      ).rejects.toThrow(BadRequestException);
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

      const result = await controller.listInstallations(mockCtx as any);

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

  describe('unlinkInstallation', () => {
    it('should set isActive to false for matching record', async () => {
      mockInstallationDao.getOne.mockResolvedValue({
        id: 'record-1',
        userId: 'user-123',
        installationId: 12345,
      } as GitHubAppInstallationEntity);

      const result = await controller.unlinkInstallation(
        '12345',
        mockCtx as any,
      );

      expect(mockInstallationDao.updateById).toHaveBeenCalledWith('record-1', {
        isActive: false,
      });
      expect(result).toEqual({ unlinked: true });
    });

    it('should return unlinked: true even when no record found', async () => {
      mockInstallationDao.getOne.mockResolvedValue(null);

      const result = await controller.unlinkInstallation(
        '12345',
        mockCtx as any,
      );

      expect(result).toEqual({ unlinked: true });
      expect(mockInstallationDao.updateById).not.toHaveBeenCalled();
    });

    it('should reject invalid installation ID', async () => {
      await expect(
        controller.unlinkInstallation('abc', mockCtx as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
