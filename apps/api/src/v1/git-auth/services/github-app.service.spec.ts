import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, DefaultLogger } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitProviderConnectionDao } from '../dao/git-provider-connection.dao';
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
const mockListInstallationsForAuthenticatedUser = vi.fn();
const mockGetOrgInstallation = vi.fn();
const mockGetUserInstallation = vi.fn();
const mockOctokitRequest = vi.fn();

vi.mock('@octokit/rest', () => {
  class MockOctokit {
    apps = {
      createInstallationAccessToken: mockCreateInstallationAccessToken,
      getInstallation: mockGetInstallation,
      getAuthenticated: mockGetAuthenticated,
      listInstallationsForAuthenticatedUser:
        mockListInstallationsForAuthenticatedUser,
      getOrgInstallation: mockGetOrgInstallation,
      getUserInstallation: mockGetUserInstallation,
    };

    request = mockOctokitRequest;

  }
  return { Octokit: MockOctokit };
});

const mockDaoGetAll = vi.fn();

describe('GitHubAppService', () => {
  let service: GitHubAppService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDaoGetAll.mockResolvedValue([]);

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
        {
          provide: GitProviderConnectionDao,
          useValue: {
            getAll: mockDaoGetAll,
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

  describe('exchangeCodeAndGetInstallations', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
      mockFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({ access_token: 'ghu_test_user_token_123' }),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should return installations from user-scoped endpoint when available', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: {
          installations: [
            {
              id: 100,
              account: { login: 'org-one', type: 'Organization' },
            },
            { id: 200, account: { login: 'user-two', type: 'User' } },
          ],
        },
      });

      const result =
        await service.exchangeCodeAndGetInstallations('test-code');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 100,
        account: { login: 'org-one', type: 'Organization' },
      });
      expect(result[1]).toEqual({
        id: 200,
        account: { login: 'user-two', type: 'User' },
      });
    });

    it('should return empty array when user-scoped returns empty and no hint is provided', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });

      const result =
        await service.exchangeCodeAndGetInstallations('test-code');

      expect(result).toEqual([]);
    });

    it('should accept a hinted installation after validating it with the user token', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockOctokitRequest.mockResolvedValue({
        data: { total_count: 0, repositories: [] },
      });
      mockGetInstallation.mockResolvedValue({
        data: {
          id: 777,
          account: { login: 'fresh-org', type: 'Organization' },
        },
      });

      const result = await service.exchangeCodeAndGetInstallations(
        'test-code',
        undefined,
        777,
      );

      expect(mockOctokitRequest).toHaveBeenCalledWith(
        'GET /user/installations/{installation_id}/repositories',
        {
          installation_id: 777,
          per_page: 1,
        },
      );
      expect(result).toEqual([
        {
          id: 777,
          account: { login: 'fresh-org', type: 'Organization' },
        },
      ]);
    });

    it('should ignore a hinted installation when the user token cannot validate access', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockOctokitRequest.mockRejectedValue(
        Object.assign(new Error('Forbidden'), { status: 403 }),
      );

      const result = await service.exchangeCodeAndGetInstallations(
        'test-code',
        undefined,
        777,
      );

      expect(result).toEqual([]);
      expect(mockGetInstallation).not.toHaveBeenCalled();
    });

    it('should throw GITHUB_APP_LIST_INSTALLATIONS_FAILED when user-scoped throws an error', async () => {
      mockListInstallationsForAuthenticatedUser.mockRejectedValue(
        new Error('OAuth scope insufficient'),
      );

      await expect(
        service.exchangeCodeAndGetInstallations('test-code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw GITHUB_OAUTH_TOKEN_EXCHANGE_FAILED when token exchange returns error', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ error: 'bad_verification_code' }),
      });

      await expect(
        service.exchangeCodeAndGetInstallations('bad-code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should fall back to targeted lookup when user-scoped returns empty', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockDaoGetAll.mockResolvedValue([
        {
          id: 'conn-1',
          accountLogin: 'my-org',
          metadata: { accountType: 'Organization', installationId: 111 },
          isActive: false,
        },
        {
          id: 'conn-2',
          accountLogin: 'my-user',
          metadata: { accountType: 'User', installationId: 222 },
          isActive: true,
        },
      ]);
      mockGetOrgInstallation.mockResolvedValue({
        data: {
          id: 111,
          account: { login: 'my-org', type: 'Organization' },
        },
      });
      mockGetUserInstallation.mockResolvedValue({
        data: {
          id: 222,
          account: { login: 'my-user', type: 'User' },
        },
      });

      const result = await service.exchangeCodeAndGetInstallations(
        'test-code',
        'user-123',
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 111,
        account: { login: 'my-org', type: 'Organization' },
      });
      expect(result[1]).toEqual({
        id: 222,
        account: { login: 'my-user', type: 'User' },
      });
      expect(mockGetOrgInstallation).toHaveBeenCalledWith({ org: 'my-org' });
      expect(mockGetUserInstallation).toHaveBeenCalledWith({
        username: 'my-user',
      });
    });

    it('should handle 404 gracefully in targeted lookup when app is uninstalled', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockDaoGetAll.mockResolvedValue([
        {
          id: 'conn-1',
          accountLogin: 'removed-org',
          metadata: { accountType: 'Organization', installationId: 333 },
          isActive: false,
        },
      ]);
      mockGetOrgInstallation.mockRejectedValue(
        Object.assign(new Error('Not Found'), { status: 404 }),
      );

      const result = await service.exchangeCodeAndGetInstallations(
        'test-code',
        'user-123',
      );

      expect(result).toEqual([]);
      expect(mockGetOrgInstallation).toHaveBeenCalledWith({
        org: 'removed-org',
      });
    });

    it('should return empty when all fallbacks are exhausted', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockDaoGetAll.mockResolvedValue([]);

      const result = await service.exchangeCodeAndGetInstallations(
        'test-code',
        'user-123',
      );

      expect(result).toEqual([]);
    });

    it('should deduplicate logins in targeted lookup', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockDaoGetAll.mockResolvedValue([
        {
          id: 'conn-1',
          accountLogin: 'my-org',
          metadata: { accountType: 'Organization', installationId: 111 },
          isActive: true,
        },
        {
          id: 'conn-2',
          accountLogin: 'my-org',
          metadata: { accountType: 'Organization', installationId: 111 },
          isActive: false,
        },
      ]);
      mockGetOrgInstallation.mockResolvedValue({
        data: {
          id: 111,
          account: { login: 'my-org', type: 'Organization' },
        },
      });

      const result = await service.exchangeCodeAndGetInstallations(
        'test-code',
        'user-123',
      );

      expect(result).toHaveLength(1);
      expect(mockGetOrgInstallation).toHaveBeenCalledTimes(1);
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
        {
          provide: GitProviderConnectionDao,
          useValue: {
            getAll: vi.fn().mockResolvedValue([]),
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
