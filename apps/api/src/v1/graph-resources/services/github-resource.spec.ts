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
    } as any;

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
      };

      const result = await githubResource.getData(config);

      expect(result).toEqual({
        information: expect.stringContaining(
          'Purpose: Work with GitHub from shell via gh CLI',
        ),
        kind: 'Shell',
        data: {
          initScript:
            'export DEBIAN_FRONTEND=noninteractive && apt-get update -y && apt-get install -y curl ca-certificates jq git && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /usr/share/keyrings/githubcli-archive-keyring.gpg >/dev/null && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && apt-get update -y && apt-get install -y gh && printf "%s" "$GITHUB_PAT_TOKEN" | gh auth login --hostname github.com --with-token && gh config set git_protocol https && git config --global pull.rebase false && gh auth status || true',
          initScriptTimeout: 120000,
          env: {
            GITHUB_PAT_TOKEN: 'ghp_1234567890abcdef',
          },
        },
      });
    });

    it('should include GitHub CLI help information', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test_token',
      };

      const result = await githubResource.getData(config);

      expect(result.information).toContain('gh help');
      expect(result.information).toContain('gh <group> --help');
      expect(result.information).toContain('gh help <command>');
      expect(result.information).toContain('gh alias list');
      expect(result.information).toContain('gh extension list');
      expect(result.information).toContain('gh api --help');
    });

    it('should set up authentication with provided token', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_my_secret_token',
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'printf "%s" "$GITHUB_PAT_TOKEN" | gh auth login --hostname github.com --with-token',
      );
    });

    it('should configure Git protocol to HTTPS', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test',
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'gh config set git_protocol https',
      );
    });

    it('should disable Git pull rebase', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test',
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'git config --global pull.rebase false',
      );
    });

    it('should include error handling in init script', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test',
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'export DEBIAN_FRONTEND=noninteractive',
      );
      expect(result.data.initScript).toContain('gh auth status || true');
    });

    it('should install required packages', async () => {
      const config: GithubResourceConfig = {
        patToken: 'ghp_test',
      };

      const result = await githubResource.getData(config);

      expect(result.data.initScript).toContain(
        'apt-get update -y && apt-get install -y curl ca-certificates jq git',
      );
      expect(result.data.initScript).toContain(
        'curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg',
      );
    });
  });

  describe('setup', () => {
    it('should not have setup method defined', () => {
      expect(githubResource.setup).toBeUndefined();
    });
  });
});
