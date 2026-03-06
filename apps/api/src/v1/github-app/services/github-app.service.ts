import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { BadRequestException, DefaultLogger } from '@packages/common';
import jwt from 'jsonwebtoken';

import { environment } from '../../../environments';

const TOKEN_CACHE_TTL_MS = 55 * 60 * 1000; // 55 minutes (tokens last ~1 hour)
const JWT_EXPIRY_SECONDS = 10 * 60; // 10 minutes

interface CachedToken {
  token: string;
  expiresAt: number;
}

@Injectable()
export class GitHubAppService {
  private readonly tokenCache = new Map<number, CachedToken>();
  private appSlug: string | null = null;

  constructor(private readonly logger: DefaultLogger) {}

  isConfigured(): boolean {
    return (
      Boolean(environment.githubAppId) &&
      Boolean(environment.githubAppPrivateKey) &&
      Boolean(environment.githubAppClientId)
    );
  }

  generateJwt(): string {
    this.assertConfigured();

    const now = Math.floor(Date.now() / 1000);
    const privateKey = (environment.githubAppPrivateKey || '').replace(
      /\\n/g,
      '\n',
    );

    return jwt.sign(
      {
        iat: now - 60, // issued 60s in the past to account for clock drift
        exp: now + JWT_EXPIRY_SECONDS,
        iss: environment.githubAppId,
      },
      privateKey,
      { algorithm: 'RS256' },
    );
  }

  async getInstallationToken(installationId: number): Promise<string> {
    this.assertConfigured();

    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const appJwt = this.generateJwt();
    const octokit = new Octokit({ auth: appJwt });

    try {
      const response = await octokit.apps.createInstallationAccessToken({
        installation_id: installationId,
      });

      const token = response.data.token;

      this.tokenCache.set(installationId, {
        token,
        expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
      });

      return token;
    } catch (error) {
      this.logger.error(
        `Failed to generate installation token for installation ${installationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException('GITHUB_APP_TOKEN_GENERATION_FAILED');
    }
  }

  async getInstallation(
    installationId: number,
  ): Promise<{ id: number; account: { login: string; type: string } }> {
    this.assertConfigured();

    const appJwt = this.generateJwt();
    const octokit = new Octokit({ auth: appJwt });

    try {
      const response = await octokit.apps.getInstallation({
        installation_id: installationId,
      });

      const account = response.data.account;
      if (!account) {
        throw new Error('Installation has no associated account');
      }

      return {
        id: response.data.id,
        account: {
          login: 'login' in account ? (account.login ?? '') : '',
          type: 'type' in account ? (account.type ?? '') : '',
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Failed to get installation ${installationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException('GITHUB_APP_INSTALLATION_FETCH_FAILED');
    }
  }

  /**
   * Exchange an OAuth authorization code for a user access token,
   * then return the user's installations of this GitHub App.
   */
  async exchangeCodeAndGetInstallations(
    code: string,
  ): Promise<{ id: number; account: { login: string; type: string } }[]> {
    const clientId = environment.githubAppClientId;
    const clientSecret = environment.githubAppClientSecret;

    if (!clientId || !clientSecret) {
      throw new BadRequestException('GITHUB_APP_OAUTH_NOT_CONFIGURED');
    }

    // Exchange code for user access token
    const tokenResponse = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      },
    );

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      this.logger.error(
        `GitHub OAuth token exchange failed: ${tokenData.error ?? 'unknown'} – ${tokenData.error_description ?? ''}`,
      );
      throw new BadRequestException('GITHUB_OAUTH_TOKEN_EXCHANGE_FAILED');
    }

    // Get user's installations for this app
    const octokit = new Octokit({ auth: tokenData.access_token });

    try {
      const response =
        await octokit.apps.listInstallationsForAuthenticatedUser();
      return response.data.installations.map((inst) => ({
        id: inst.id,
        account: {
          login: inst.account
            ? 'login' in inst.account
              ? (inst.account.login ?? '')
              : ''
            : '',
          type: inst.account
            ? 'type' in inst.account
              ? (inst.account.type ?? '')
              : ''
            : '',
        },
      }));
    } catch (error) {
      this.logger.error(
        `Failed to list user installations: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException('GITHUB_APP_LIST_INSTALLATIONS_FAILED');
    }
  }

  async getAppSlug(): Promise<string | null> {
    if (this.appSlug) return this.appSlug;

    try {
      const appJwt = this.generateJwt();
      const octokit = new Octokit({ auth: appJwt });
      const { data } = await octokit.apps.getAuthenticated();
      this.appSlug = data?.slug ?? null;
      return this.appSlug;
    } catch (e) {
      this.logger.debug('Failed to fetch GitHub App slug', e);
      return null;
    }
  }

  /**
   * Delete a GitHub App installation from GitHub's side.
   * This revokes all access the App had to the org/user repos.
   */
  async deleteInstallation(installationId: number): Promise<void> {
    this.assertConfigured();

    const appJwt = this.generateJwt();
    const octokit = new Octokit({ auth: appJwt });

    try {
      await octokit.apps.deleteInstallation({
        installation_id: installationId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to delete GitHub App installation ${installationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException('GITHUB_APP_INSTALLATION_DELETE_FAILED');
    } finally {
      this.tokenCache.delete(installationId);
    }
  }

  /** Invalidate a cached token (e.g. when an installation is deleted). */
  invalidateCachedToken(installationId: number): void {
    this.tokenCache.delete(installationId);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new BadRequestException('GITHUB_APP_NOT_CONFIGURED');
    }
  }
}
