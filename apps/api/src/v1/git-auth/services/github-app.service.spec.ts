import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  DefaultLogger,
  ForbiddenException,
} from '@packages/common';
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
const mockDeleteInstallation = vi.fn();
const mockListInstallationsForAuthenticatedUser = vi.fn();
const mockListInstallations = vi.fn();
const mockListForAuthenticatedUser = vi.fn();
const mockGetAuthenticatedUser = vi.fn();

vi.mock('@octokit/rest', () => {
  class MockOctokit {
    apps = {
      createInstallationAccessToken: mockCreateInstallationAccessToken,
      getInstallation: mockGetInstallation,
      getAuthenticated: mockGetAuthenticated,
      deleteInstallation: mockDeleteInstallation,
      listInstallationsForAuthenticatedUser:
        mockListInstallationsForAuthenticatedUser,
      listInstallations: mockListInstallations,
    };

    orgs = {
      listForAuthenticatedUser: mockListForAuthenticatedUser,
    };

    users = {
      getAuthenticated: mockGetAuthenticatedUser,
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
      expect(mockListInstallations).not.toHaveBeenCalled();
    });

    it('should fall back to app-level listInstallations filtered by user orgs when user-scoped returns empty', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockListForAuthenticatedUser.mockResolvedValue({
        data: [{ login: 'org-three' }],
      });
      mockGetAuthenticatedUser.mockResolvedValue({
        data: { login: 'my-user' },
      });
      mockListInstallations.mockResolvedValue({
        data: [
          { id: 300, account: { login: 'org-three', type: 'Organization' } },
          { id: 301, account: { login: 'other-org', type: 'Organization' } },
          { id: 302, account: { login: 'my-user', type: 'User' } },
        ],
      });

      const result =
        await service.exchangeCodeAndGetInstallations('test-code');

      expect(mockListInstallationsForAuthenticatedUser).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 300,
        account: { login: 'org-three', type: 'Organization' },
      });
      expect(result[1]).toEqual({
        id: 302,
        account: { login: 'my-user', type: 'User' },
      });
      expect(mockListInstallations).toHaveBeenCalled();
    });

    it('should return empty array when both endpoints return empty', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockListForAuthenticatedUser.mockResolvedValue({ data: [] });
      mockGetAuthenticatedUser.mockResolvedValue({
        data: { login: 'my-user' },
      });
      mockListInstallations.mockResolvedValue({ data: [] });

      const result =
        await service.exchangeCodeAndGetInstallations('test-code');

      expect(result).toEqual([]);
    });

    it('should return empty array when user-scoped is empty and app-level throws', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockListForAuthenticatedUser.mockResolvedValue({ data: [] });
      mockGetAuthenticatedUser.mockResolvedValue({
        data: { login: 'my-user' },
      });
      mockListInstallations.mockRejectedValue(
        new Error('App JWT auth failed'),
      );

      const result =
        await service.exchangeCodeAndGetInstallations('test-code');

      expect(result).toEqual([]);
    });

    it('should throw GITHUB_APP_LIST_INSTALLATIONS_FAILED when user-scoped throws an error', async () => {
      mockListInstallationsForAuthenticatedUser.mockRejectedValue(
        new Error('OAuth scope insufficient'),
      );

      await expect(
        service.exchangeCodeAndGetInstallations('test-code'),
      ).rejects.toThrow(BadRequestException);

      expect(mockListInstallations).not.toHaveBeenCalled();
    });

    it('should throw GITHUB_OAUTH_TOKEN_EXCHANGE_FAILED when token exchange returns error', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ error: 'bad_verification_code' }),
      });

      await expect(
        service.exchangeCodeAndGetInstallations('bad-code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use installationId hint when all other methods return empty', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockListForAuthenticatedUser.mockResolvedValue({
        data: [{ login: 'my-org' }],
      });
      mockGetAuthenticatedUser.mockResolvedValue({
        data: { login: 'my-user' },
      });
      mockListInstallations.mockResolvedValue({ data: [] });
      mockGetInstallation.mockResolvedValue({
        data: {
          id: 55555,
          account: { login: 'my-org', type: 'Organization' },
        },
      });

      const result = await service.exchangeCodeAndGetInstallations(
        'test-code',
        55555,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 55555,
        account: { login: 'my-org', type: 'Organization' },
      });
    });

    it('should throw ForbiddenException when hinted installation does not match user access', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockListForAuthenticatedUser.mockResolvedValue({ data: [] });
      mockGetAuthenticatedUser.mockResolvedValue({
        data: { login: 'my-user' },
      });
      mockListInstallations.mockResolvedValue({ data: [] });
      mockGetInstallation.mockResolvedValue({
        data: {
          id: 99999,
          account: { login: 'foreign-org', type: 'Organization' },
        },
      });

      await expect(
        service.exchangeCodeAndGetInstallations('test-code', 99999),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should not use installationId hint when user-scoped list returns results', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: {
          installations: [
            {
              id: 100,
              account: { login: 'org-one', type: 'Organization' },
            },
          ],
        },
      });

      const result = await service.exchangeCodeAndGetInstallations(
        'test-code',
        99999,
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(100);
      expect(mockGetInstallation).not.toHaveBeenCalled();
    });

    it('should return empty array when hint is not provided and all methods return empty', async () => {
      mockListInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      mockListForAuthenticatedUser.mockResolvedValue({ data: [] });
      mockGetAuthenticatedUser.mockResolvedValue({
        data: { login: 'my-user' },
      });
      mockListInstallations.mockResolvedValue({ data: [] });

      const result =
        await service.exchangeCodeAndGetInstallations('test-code');

      expect(result).toEqual([]);
      expect(mockGetInstallation).not.toHaveBeenCalled();
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

  describe('deleteInstallation', () => {
    it('should delete installation and clear token cache on success', async () => {
      mockCreateInstallationAccessToken.mockResolvedValue({
        data: { token: 'ghs_cached_token' },
      });
      mockDeleteInstallation.mockResolvedValue(undefined);

      // Populate the cache first
      await service.getInstallationToken(12345);
      expect(mockCreateInstallationAccessToken).toHaveBeenCalledTimes(1);

      await service.deleteInstallation(12345);

      expect(mockDeleteInstallation).toHaveBeenCalledWith({
        installation_id: 12345,
      });

      // After deletion, the cache should be cleared — a fresh token fetch hits the API again
      mockCreateInstallationAccessToken.mockResolvedValue({
        data: { token: 'ghs_new_token' },
      });
      const newToken = await service.getInstallationToken(12345);
      expect(newToken).toBe('ghs_new_token');
      expect(mockCreateInstallationAccessToken).toHaveBeenCalledTimes(2);
    });

    it('should clear token cache even when GitHub API deletion fails', async () => {
      mockCreateInstallationAccessToken.mockResolvedValue({
        data: { token: 'ghs_cached_token' },
      });
      mockDeleteInstallation.mockRejectedValue(new Error('GitHub API error'));

      // Populate the cache first
      await service.getInstallationToken(12345);
      expect(mockCreateInstallationAccessToken).toHaveBeenCalledTimes(1);

      await expect(service.deleteInstallation(12345)).rejects.toThrow(
        BadRequestException,
      );

      // Despite the failure, the cache entry should have been cleared
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
