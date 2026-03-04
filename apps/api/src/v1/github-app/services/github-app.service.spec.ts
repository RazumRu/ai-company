import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, DefaultLogger } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubAppService } from './github-app.service';

// Mock jsonwebtoken
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('mock-jwt-token'),
  },
}));

import * as envModule from '../../../environments';

// Mock the environment
vi.mock('../../../environments', () => ({
  environment: {
    githubAppId: 'test-app-id',
    githubAppPrivateKey:
      '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----',
    githubAppClientId: 'Iv1.test-client-id',
    githubAppClientSecret: 'test-client-secret',
  },
}));

// Mock Octokit
const mockCreateInstallationAccessToken = vi.fn();
const mockGetInstallation = vi.fn();
const mockGetAuthenticated = vi.fn();

vi.mock('@octokit/rest', () => {
  class MockOctokit {
    apps = {
      createInstallationAccessToken: mockCreateInstallationAccessToken,
      getInstallation: mockGetInstallation,
      getAuthenticated: mockGetAuthenticated,
    };
  }
  return { Octokit: MockOctokit };
});

describe('GitHubAppService', () => {
  let service: GitHubAppService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubAppService,
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

    service = module.get<GitHubAppService>(GitHubAppService);
  });

  describe('isConfigured', () => {
    it('should return true when appId and privateKey are set', () => {
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('generateJwt', () => {
    it('should generate a JWT token', () => {
      const jwt = service.generateJwt();
      expect(jwt).toBe('mock-jwt-token');
    });
  });

  describe('getInstallationToken', () => {
    it('should fetch and return installation token from GitHub API', async () => {
      mockCreateInstallationAccessToken.mockResolvedValue({
        data: { token: 'ghs_installation_token_123' },
      });

      const token = await service.getInstallationToken(12345);
      expect(token).toBe('ghs_installation_token_123');
      expect(mockCreateInstallationAccessToken).toHaveBeenCalledWith({
        installation_id: 12345,
      });
    });

    it('should return cached token on subsequent calls within TTL', async () => {
      mockCreateInstallationAccessToken.mockResolvedValue({
        data: { token: 'ghs_cached_token' },
      });

      const token1 = await service.getInstallationToken(12345);
      const token2 = await service.getInstallationToken(12345);

      expect(token1).toBe('ghs_cached_token');
      expect(token2).toBe('ghs_cached_token');
      // Only one API call should have been made
      expect(mockCreateInstallationAccessToken).toHaveBeenCalledTimes(1);
    });

    it('should throw GITHUB_APP_TOKEN_GENERATION_FAILED when GitHub API errors', async () => {
      mockCreateInstallationAccessToken.mockRejectedValue(
        new Error('API error'),
      );

      await expect(service.getInstallationToken(12345)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getInstallation', () => {
    it('should return installation details', async () => {
      mockGetInstallation.mockResolvedValue({
        data: {
          id: 12345,
          account: { login: 'my-org', type: 'Organization' },
        },
      });

      const result = await service.getInstallation(12345);
      expect(result.id).toBe(12345);
      expect(result.account.login).toBe('my-org');
      expect(result.account.type).toBe('Organization');
    });

    it('should throw when installation has no account', async () => {
      mockGetInstallation.mockResolvedValue({
        data: { id: 12345, account: null },
      });

      await expect(service.getInstallation(12345)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw when GitHub API errors', async () => {
      mockGetInstallation.mockRejectedValue(new Error('Not found'));

      await expect(service.getInstallation(12345)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getAppSlug', () => {
    it('should fetch and return the app slug from GitHub API', async () => {
      mockGetAuthenticated.mockResolvedValue({
        data: { slug: 'my-github-app' },
      });

      const slug = await service.getAppSlug();
      expect(slug).toBe('my-github-app');
      expect(mockGetAuthenticated).toHaveBeenCalledTimes(1);
    });

    it('should return cached slug on subsequent calls', async () => {
      mockGetAuthenticated.mockResolvedValue({
        data: { slug: 'my-github-app' },
      });

      const slug1 = await service.getAppSlug();
      const slug2 = await service.getAppSlug();

      expect(slug1).toBe('my-github-app');
      expect(slug2).toBe('my-github-app');
      expect(mockGetAuthenticated).toHaveBeenCalledTimes(1);
    });

    it('should return null when GitHub API call fails', async () => {
      mockGetAuthenticated.mockRejectedValue(new Error('API error'));

      const slug = await service.getAppSlug();
      expect(slug).toBeNull();
    });
  });

  describe('invalidateCachedToken', () => {
    it('should remove cached token for the given installationId', async () => {
      mockCreateInstallationAccessToken.mockResolvedValue({
        data: { token: 'ghs_to_be_invalidated' },
      });

      await service.getInstallationToken(12345);
      expect(mockCreateInstallationAccessToken).toHaveBeenCalledTimes(1);

      service.invalidateCachedToken(12345);

      mockCreateInstallationAccessToken.mockResolvedValue({
        data: { token: 'ghs_new_token' },
      });

      const newToken = await service.getInstallationToken(12345);
      expect(newToken).toBe('ghs_new_token');
      expect(mockCreateInstallationAccessToken).toHaveBeenCalledTimes(2);
    });
  });
});

describe('GitHubAppService (unconfigured)', () => {
  let service: GitHubAppService;
  const originalEnv = { ...envModule.environment };

  beforeEach(async () => {
    // Override the mocked environment to simulate unconfigured state
    Object.assign(envModule.environment, {
      githubAppId: undefined,
      githubAppPrivateKey: undefined,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubAppService,
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

    service = module.get<GitHubAppService>(GitHubAppService);
  });

  afterEach(() => {
    // Restore original mock values
    Object.assign(envModule.environment, originalEnv);
  });

  it('should return false from isConfigured when env vars are undefined', () => {
    expect(service.isConfigured()).toBe(false);
  });

  it('should throw GITHUB_APP_NOT_CONFIGURED when generating JWT without config', () => {
    expect(() => service.generateJwt()).toThrow(BadRequestException);
  });

  it('should throw GITHUB_APP_NOT_CONFIGURED when getting installation token without config', async () => {
    await expect(service.getInstallationToken(12345)).rejects.toThrow(
      BadRequestException,
    );
  });
});
