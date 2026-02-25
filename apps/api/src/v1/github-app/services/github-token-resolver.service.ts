import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { GitHubAuthMethod } from '../../graph-resources/graph-resources.types';
import { GitHubAppInstallationDao } from '../dao/github-app-installation.dao';
import { GitHubAppService } from './github-app.service';

export interface ResolvedToken {
  token: string;
  source: GitHubAuthMethod;
}

@Injectable()
export class GitHubTokenResolverService {
  constructor(
    private readonly gitHubAppService: GitHubAppService,
    private readonly gitHubAppInstallationDao: GitHubAppInstallationDao,
    private readonly logger: DefaultLogger,
  ) {}

  /**
   * Resolves a GitHub token for a specific owner (org/user).
   * Prefers GitHub App installation tokens over PATs.
   */
  async resolveTokenForOwner(
    owner: string,
    userId: string,
    patToken?: string,
  ): Promise<ResolvedToken | null> {
    if (this.gitHubAppService.isConfigured()) {
      // 1. Try exact match by owner (org/user that owns the repo)
      const installation = await this.gitHubAppInstallationDao.getOne({
        userId,
        accountLogin: owner,
        isActive: true,
      });

      if (installation) {
        try {
          const token = await this.gitHubAppService.getInstallationToken(
            installation.installationId,
          );
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
      if (!installation) {
        const fallbackInstallation = await this.gitHubAppInstallationDao.getOne(
          {
            userId,
            isActive: true,
          },
        );

        if (fallbackInstallation) {
          try {
            const token = await this.gitHubAppService.getInstallationToken(
              fallbackInstallation.installationId,
            );
            this.logger.log(
              `No GitHub App installation for owner ${owner}, using fallback installation ${fallbackInstallation.accountLogin}`,
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

    if (patToken) {
      return { token: patToken, source: GitHubAuthMethod.Pat };
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

    const installation = await this.gitHubAppInstallationDao.getOne({
      userId,
      isActive: true,
    });

    if (!installation) {
      return null;
    }

    try {
      const token = await this.gitHubAppService.getInstallationToken(
        installation.installationId,
      );
      return { token, source: GitHubAuthMethod.GithubApp };
    } catch (error) {
      this.logger.warn(
        `Failed to get default GitHub App token for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
