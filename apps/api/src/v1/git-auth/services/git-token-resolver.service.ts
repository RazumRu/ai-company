import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { GitHubAuthMethod } from '../../graph-resources/graph-resources.types';
import { GitProviderConnectionDao } from '../dao/git-provider-connection.dao';
import { GitProvider } from '../types/git-provider.enum';
import { GitHubAppService } from './github-app.service';

export interface ResolvedToken {
  token: string;
  source: GitHubAuthMethod;
}

@Injectable()
export class GitTokenResolverService {
  constructor(
    private readonly gitHubAppService: GitHubAppService,
    private readonly gitProviderConnectionDao: GitProviderConnectionDao,
    private readonly logger: DefaultLogger,
  ) {}

  /**
   * Resolves a Git token for a specific owner (org/user)
   * using the appropriate provider's authentication method.
   */
  async resolveToken(
    provider: GitProvider,
    owner: string,
    userId: string,
  ): Promise<ResolvedToken | null> {
    if (provider !== GitProvider.GitHub) {
      return null;
    }

    if (this.gitHubAppService.isConfigured()) {
      // 1. Try exact match by owner (org/user that owns the repo)
      const connection = await this.gitProviderConnectionDao.getOne({
        userId,
        provider,
        accountLogin: owner,
        isActive: true,
      });

      if (connection) {
        try {
          const installationId = connection.metadata[
            'installationId'
          ] as number;
          const token =
            await this.gitHubAppService.getInstallationToken(installationId);
          return { token, source: GitHubAuthMethod.GithubApp };
        } catch (error) {
          this.logger.warn(
            `Failed to get GitHub App token for owner ${owner}, falling back: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // 2. Fallback: try any active installation for the user.
      // The user may have a personal installation that also has access to
      // org repos.
      // GitHub's API will enforce actual repo access permissions.
      if (!connection) {
        const fallbackConnection = await this.gitProviderConnectionDao.getOne({
          userId,
          provider,
          isActive: true,
        });

        if (fallbackConnection) {
          try {
            const installationId = fallbackConnection.metadata[
              'installationId'
            ] as number;
            const token =
              await this.gitHubAppService.getInstallationToken(installationId);
            this.logger.log(
              `No GitHub App installation for owner ${owner}, using fallback installation ${fallbackConnection.accountLogin}`,
            );
            return { token, source: GitHubAuthMethod.GithubApp };
          } catch (error) {
            this.logger.warn(
              `Failed to get fallback GitHub App token for owner ${owner}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }

    return null;
  }

  /**
   * Resolves a default GitHub token for a user (any owner).
   * Used when the target repo is not yet known (e.g. init script auth).
   */
  async resolveDefaultToken(userId: string): Promise<ResolvedToken | null> {
    if (!this.gitHubAppService.isConfigured()) {
      return null;
    }

    const connection = await this.gitProviderConnectionDao.getOne({
      userId,
      provider: GitProvider.GitHub,
      isActive: true,
    });

    if (!connection) {
      return null;
    }

    try {
      const installationId = connection.metadata['installationId'] as number;
      const token =
        await this.gitHubAppService.getInstallationToken(installationId);
      return { token, source: GitHubAuthMethod.GithubApp };
    } catch (error) {
      this.logger.warn(
        `Failed to get default GitHub App token for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
