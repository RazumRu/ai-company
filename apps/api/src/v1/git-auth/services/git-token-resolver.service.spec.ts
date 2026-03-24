import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubAuthMethod } from '../../graph-resources/graph-resources.types';
import { GitProviderConnectionDao } from '../dao/git-provider-connection.dao';
import { GitProviderConnectionEntity } from '../entity/git-provider-connection.entity';
import { GitProvider } from '../git-auth.types';
import { GitTokenResolverService } from './git-token-resolver.service';
import { GitHubAppService } from './github-app.service';

describe('GitTokenResolverService', () => {
  let service: GitTokenResolverService;
  let mockGitHubAppService: {
    isConfigured: ReturnType<typeof vi.fn>;
    getInstallationToken: ReturnType<typeof vi.fn>;
  };
  let mockConnectionDao: {
    getOne: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockGitHubAppService = {
      isConfigured: vi.fn().mockReturnValue(true),
      getInstallationToken: vi.fn().mockResolvedValue('ghs_app_token'),
    };

    mockConnectionDao = {
      getOne: vi.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitTokenResolverService,
        {
          provide: GitHubAppService,
          useValue: mockGitHubAppService,
        },
        {
          provide: GitProviderConnectionDao,
          useValue: mockConnectionDao,
        },
        {
          provide: DefaultLogger,
          useValue: {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GitTokenResolverService>(GitTokenResolverService);
  });

  describe('resolveToken', () => {
    it('should return GitHub App token when connection exists', async () => {
      mockConnectionDao.getOne.mockResolvedValue({
        metadata: { installationId: 12345 },
        isActive: true,
      } as unknown as GitProviderConnectionEntity);

      const result = await service.resolveToken(
        GitProvider.GitHub,
        'my-org',
        'user-1',
      );

      expect(result).toEqual({
        token: 'ghs_app_token',
        source: GitHubAuthMethod.GithubApp,
      });
      expect(mockConnectionDao.getOne).toHaveBeenCalledWith({
        userId: 'user-1',
        provider: GitProvider.GitHub,
        accountLogin: 'my-org',
        isActive: true,
      });
    });

    it('should return null when no connection found', async () => {
      mockConnectionDao.getOne.mockResolvedValue(null);

      const result = await service.resolveToken(
        GitProvider.GitHub,
        'my-org',
        'user-1',
      );

      expect(result).toBeNull();
      expect(mockConnectionDao.getOne).toHaveBeenCalledTimes(1);
    });

    it('should return null when App token generation fails and no fallback', async () => {
      mockConnectionDao.getOne.mockResolvedValue({
        metadata: { installationId: 12345 },
        isActive: true,
      } as unknown as GitProviderConnectionEntity);
      mockGitHubAppService.getInstallationToken.mockRejectedValue(
        new Error('Token generation failed'),
      );

      const result = await service.resolveToken(
        GitProvider.GitHub,
        'my-org',
        'user-1',
      );

      expect(result).toBeNull();
    });

    it('should return null when GitHub App is not configured', async () => {
      mockGitHubAppService.isConfigured.mockReturnValue(false);

      const result = await service.resolveToken(
        GitProvider.GitHub,
        'my-org',
        'user-1',
      );

      expect(result).toBeNull();
      expect(mockConnectionDao.getOne).not.toHaveBeenCalled();
    });

    it('should return null for non-GitHub providers', async () => {
      const result = await service.resolveToken(
        GitProvider.GitLab,
        'my-org',
        'user-1',
      );

      expect(result).toBeNull();
      expect(mockConnectionDao.getOne).not.toHaveBeenCalled();
    });

    it('should return null when no exact owner match exists without falling back', async () => {
      mockConnectionDao.getOne.mockResolvedValue(null);

      const result = await service.resolveToken(
        GitProvider.GitHub,
        'unknown-owner',
        'user-1',
      );

      expect(result).toBeNull();
      expect(mockConnectionDao.getOne).toHaveBeenCalledTimes(1);
      expect(mockConnectionDao.getOne).toHaveBeenCalledWith({
        userId: 'user-1',
        provider: GitProvider.GitHub,
        accountLogin: 'unknown-owner',
        isActive: true,
      });
    });
  });

  describe('resolveDefaultToken', () => {
    it('should return token from first active connection', async () => {
      mockConnectionDao.getOne.mockResolvedValue({
        metadata: { installationId: 99999 },
        isActive: true,
      } as unknown as GitProviderConnectionEntity);

      const result = await service.resolveDefaultToken('user-1');

      expect(result).toEqual({
        token: 'ghs_app_token',
        source: GitHubAuthMethod.GithubApp,
      });
      expect(mockConnectionDao.getOne).toHaveBeenCalledWith({
        userId: 'user-1',
        provider: GitProvider.GitHub,
        isActive: true,
      });
    });

    it('should return null when no connection exists', async () => {
      mockConnectionDao.getOne.mockResolvedValue(null);

      const result = await service.resolveDefaultToken('user-1');

      expect(result).toBeNull();
    });

    it('should return null when GitHub App is not configured', async () => {
      mockGitHubAppService.isConfigured.mockReturnValue(false);

      const result = await service.resolveDefaultToken('user-1');

      expect(result).toBeNull();
      expect(mockConnectionDao.getOne).not.toHaveBeenCalled();
    });

    it('should return null when token generation fails', async () => {
      mockConnectionDao.getOne.mockResolvedValue({
        metadata: { installationId: 99999 },
        isActive: true,
      } as unknown as GitProviderConnectionEntity);
      mockGitHubAppService.getInstallationToken.mockRejectedValue(
        new Error('Failed'),
      );

      const result = await service.resolveDefaultToken('user-1');

      expect(result).toBeNull();
    });
  });
});
