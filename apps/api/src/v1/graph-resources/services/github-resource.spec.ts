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
    it('should return GitHub resource data with credential helper when auth enabled', async () => {
      const config: GithubResourceConfig = {
        auth: true,
      };

      const result = await githubResource.getData(config);

      expect(result.information).toContain(
        'Purpose: Work with GitHub from shell via gh CLI',
      );
      expect(result.kind).toBe('Shell');
      expect(result.data.initScriptTimeout).toBe(300000);
      expect(result.data.initScript).toContain('set -eu');
      expect(result.data.initScript).toContain('credential.helper');
      expect(result.data.initScript).toContain('x-access-token');
      expect(result.data.initScript).toContain('GH_TOKEN');
      expect(result.data.initScript).toContain(
        'gh config set git_protocol https',
      );
      expect(result.data.env).toEqual({});
    });

    it('should configure git user name when name is provided', async () => {
      const config: GithubResourceConfig = {
        name: 'Test User',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'git config --global user.name "Test User"',
      );
    });

    it('should configure default git user name when name is not provided', async () => {
      const config: GithubResourceConfig = {
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'git config --global user.name "Geniro Bot"',
      );
    });

    it('should configure default git email when email is not provided', async () => {
      const config: GithubResourceConfig = {
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'git config --global user.email "bot@geniro.io"',
      );
    });

    it('should configure git user email when email is provided', async () => {
      const config: GithubResourceConfig = {
        email: 'user@example.com',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'git config --global user.email "user@example.com"',
      );
    });

    it('should use provided name and fall back to default email when only name is given', async () => {
      const config: GithubResourceConfig = {
        name: 'Custom User',
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'git config --global user.name "Custom User"',
      );
      expect(result.data.initScript).toContain(
        'git config --global user.email "bot@geniro.io"',
      );
    });

    it('should include GitHub CLI help information', async () => {
      const config: GithubResourceConfig = {
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

    it('should set up credential helper when auth is true', async () => {
      const config: GithubResourceConfig = {
        auth: true,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain('credential.helper');
      expect(result.data.initScript).toContain('x-access-token');
      expect(result.data.initScript).toContain('GH_TOKEN');
    });

    it('should not set up credential helper when auth is false', async () => {
      const config: GithubResourceConfig = {
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).not.toContain('credential.helper');
    });

    it('should set up credential helper by default when auth is not specified', async () => {
      const config: GithubResourceConfig = {};

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain('credential.helper');
      expect(result.data.initScript).toContain('x-access-token');
      expect(result.data.initScript).toContain('GH_TOKEN');
    });

    it('should configure Git protocol to HTTPS', async () => {
      const config: GithubResourceConfig = {
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'gh config set git_protocol https',
      );
    });

    it('should disable Git pull rebase', async () => {
      const config: GithubResourceConfig = {
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'git config --global pull.rebase false',
      );
    });

    it('should include error handling in init script', async () => {
      const config: GithubResourceConfig = {
        auth: false,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain('set -eu');
      expect(result.data.initScript).toContain(
        'gh config set git_protocol https',
      );
      expect(result.data.initScript).toContain(
        'git config --global pull.rebase false',
      );
    });

    it('should have default git identity for ephemeral containers', async () => {
      const config: GithubResourceConfig = {
        auth: true,
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'git config --global user.name "Geniro Bot"',
      );
      expect(result.data.initScript).toContain(
        'git config --global user.email "bot@geniro.io"',
      );
    });

    it('should return empty env object', async () => {
      const config: GithubResourceConfig = {
        auth: true,
      };

      const result = await githubResource.getData(config);

      expect(result.data.env).toEqual({});
    });
  });

  describe('setup', () => {
    it('should not have setup method defined', () => {
      expect(githubResource.setup).toBeUndefined();
    });
  });
});
