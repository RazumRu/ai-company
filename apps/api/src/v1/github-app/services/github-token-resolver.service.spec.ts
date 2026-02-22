import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubAuthMethod } from '../../graph-resources/graph-resources.types';
import { GitHubAppInstallationDao } from '../dao/github-app-installation.dao';
import { GitHubAppInstallationEntity } from '../entity/github-app-installation.entity';
import { GitHubAppService } from './github-app.service';
import { GitHubTokenResolverService } from './github-token-resolver.service';

describe('GitHubTokenResolverService', () => {
  let service: GitHubTokenResolverService;
  let mockGitHubAppService: {
    isConfigured: ReturnType<typeof vi.fn>;
    getInstallationToken: ReturnType<typeof vi.fn>;
  };
  let mockInstallationDao: {
    getOne: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockGitHubAppService = {
      isConfigured: vi.fn().mockReturnValue(true),
      getInstallationToken: vi.fn().mockResolvedValue('ghs_app_token'),
    };

    mockInstallationDao = {
      getOne: vi.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubTokenResolverService,
        {
          provide: GitHubAppService,
          useValue: mockGitHubAppService,
        },
        {
          provide: GitHubAppInstallationDao,
          useValue: mockInstallationDao,
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

    service = module.get<GitHubTokenResolverService>(
      GitHubTokenResolverService,
    );
  });

  describe('resolveTokenForOwner', () => {
    it('should prefer GitHub App token when installation exists', async () => {
      mockInstallationDao.getOne.mockResolvedValue({
        installationId: 12345,
        isActive: true,
      } as GitHubAppInstallationEntity);

      const result = await service.resolveTokenForOwner(
        'my-org',
        'user-1',
        'ghp_pat_token',
      );

      expect(result).toEqual({
        token: 'ghs_app_token',
        source: GitHubAuthMethod.GithubApp,
      });
      expect(mockInstallationDao.getOne).toHaveBeenCalledWith({
        userId: 'user-1',
        accountLogin: 'my-org',
        isActive: true,
      });
    });

    it('should fall back to PAT when no installation found', async () => {
      mockInstallationDao.getOne.mockResolvedValue(null);

      const result = await service.resolveTokenForOwner(
        'my-org',
        'user-1',
        'ghp_pat_token',
      );

      expect(result).toEqual({
        token: 'ghp_pat_token',
        source: GitHubAuthMethod.Pat,
      });
    });

    it('should fall back to PAT when App token generation fails', async () => {
      mockInstallationDao.getOne.mockResolvedValue({
        installationId: 12345,
        isActive: true,
      } as GitHubAppInstallationEntity);
      mockGitHubAppService.getInstallationToken.mockRejectedValue(
        new Error('Token generation failed'),
      );

      const result = await service.resolveTokenForOwner(
        'my-org',
        'user-1',
        'ghp_pat_token',
      );

      expect(result).toEqual({
        token: 'ghp_pat_token',
        source: GitHubAuthMethod.Pat,
      });
    });

    it('should return null when nothing is available', async () => {
      mockInstallationDao.getOne.mockResolvedValue(null);

      const result = await service.resolveTokenForOwner(
        'my-org',
        'user-1',
        undefined,
      );

      expect(result).toBeNull();
    });

    it('should skip GitHub App lookup when not configured', async () => {
      mockGitHubAppService.isConfigured.mockReturnValue(false);

      const result = await service.resolveTokenForOwner(
        'my-org',
        'user-1',
        'ghp_pat_token',
      );

      expect(result).toEqual({
        token: 'ghp_pat_token',
        source: GitHubAuthMethod.Pat,
      });
      expect(mockInstallationDao.getOne).not.toHaveBeenCalled();
    });
  });

  describe('resolveDefaultToken', () => {
    it('should return token from first active installation', async () => {
      mockInstallationDao.getOne.mockResolvedValue({
        installationId: 99999,
        isActive: true,
      } as GitHubAppInstallationEntity);

      const result = await service.resolveDefaultToken('user-1');

      expect(result).toEqual({
        token: 'ghs_app_token',
        source: GitHubAuthMethod.GithubApp,
      });
      expect(mockInstallationDao.getOne).toHaveBeenCalledWith({
        userId: 'user-1',
        isActive: true,
      });
    });

    it('should return null when no installation exists', async () => {
      mockInstallationDao.getOne.mockResolvedValue(null);

      const result = await service.resolveDefaultToken('user-1');

      expect(result).toBeNull();
    });

    it('should return null when GitHub App is not configured', async () => {
      mockGitHubAppService.isConfigured.mockReturnValue(false);

      const result = await service.resolveDefaultToken('user-1');

      expect(result).toBeNull();
      expect(mockInstallationDao.getOne).not.toHaveBeenCalled();
    });

    it('should return null when token generation fails', async () => {
      mockInstallationDao.getOne.mockResolvedValue({
        installationId: 99999,
        isActive: true,
      } as GitHubAppInstallationEntity);
      mockGitHubAppService.getInstallationToken.mockRejectedValue(
        new Error('Failed'),
      );

      const result = await service.resolveDefaultToken('user-1');

      expect(result).toBeNull();
    });
  });
});
