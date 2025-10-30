import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GithubResource, GithubResourceConfig } from './github-resource';

describe('GithubResource', () => {
  let githubResource: GithubResource;
  let mockLogger: DefaultLogger;

  beforeEach(async () => {
    mockLogger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
    } as unknown as DefaultLogger;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubResource,
        {
          provide: DefaultLogger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    githubResource = await module.resolve<GithubResource>(GithubResource);
  });

  describe('getData', () => {
    it('should return GitHub resource data with PAT token', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_1234567890abcdef',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.information).toContain(
        'Purpose: Work with GitHub from shell via gh CLI',
      );
      expect(result.kind).toBe('Shell');
      expect(result.data.initScriptTimeout).toBe(300000);
      expect(result.data.initScript).toContain('set -eu');
      expect(result.data.initScript).not.toContain('gh auth login');
      expect(result.data.initScript).not.toContain('gh auth status');
      expect(result.data.initScript).toContain(
        'gh config set git_protocol https',
      );
      expect(result.data.env?.GITHUB_PAT_TOKEN).toBe('ghp_1234567890abcdef');
    });

    it('should configure git user name when name is provided', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test_token',
        name: 'Test User',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'git config --global user.name "Test User"',
      );
    });

    it('should not configure git user name when name is not provided', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test_token',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).not.toContain(
        'git config --global user.name',
      );
    });

    it('should accept optional avatar field', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test_token',
        avatar: 'https://example.com/avatar.png',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.env?.GITHUB_PAT_TOKEN).toBe('ghp_test_token');
      // Avatar is stored but not used in init script
    });

    it('should work with both name and avatar provided', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test_token',
        name: 'Test User',
        avatar: 'https://example.com/avatar.png',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'git config --global user.name "Test User"',
      );
      expect(result.data.env?.GITHUB_PAT_TOKEN).toBe('ghp_test_token');
    });

    it('should include GitHub CLI help information', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test_token',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.information).toContain('gh help');
      expect(result.information).toContain('gh <group> --help');
      expect(result.information).toContain('gh help <command>');
      expect(result.information).toContain('gh alias list');
      expect(result.information).toContain('gh extension list');
      expect(result.information).toContain('gh api --help');
    });

    it('should set up authentication with provided token when auth is true', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_my_secret_token',
        auth: true,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'printf "%s" "$GITHUB_PAT_TOKEN" | gh auth login --hostname github.com --with-token',
      );
      expect(result.data.initScript).toContain('gh auth status');
    });

    it('should not set up authentication when auth is false', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_my_secret_token',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).not.toContain(
        'printf "%s" "$GITHUB_PAT_TOKEN" | gh auth login --hostname github.com --with-token',
      );
      expect(result.data.initScript).not.toContain('gh auth status');
    });

    it('should set up authentication by default when auth is not specified', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_my_secret_token',
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'printf "%s" "$GITHUB_PAT_TOKEN" | gh auth login --hostname github.com --with-token',
      );
      expect(result.data.initScript).toContain('gh auth status');
    });

    it('should configure Git protocol to HTTPS', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'gh config set git_protocol https',
      );
    });

    it('should disable Git pull rebase', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'git config --global pull.rebase false',
      );
    });

    it('should include error handling in init script', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain('set -eu');
      expect(result.data.initScript).toContain(
        'export DEBIAN_FRONTEND=noninteractive',
      );
    });

    it('should install required packages', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain('command -v');
      expect(result.data.initScript).toContain('curl');
      expect(result.data.initScript).toContain('git');
    });
  });

  describe('setup', () => {
    it('should not have setup method defined', () => {
      expect(githubResource.setup).toBeUndefined();
    });
  });
});
