import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { BadRequestException, DefaultLogger } from '@packages/common';
import jwt from 'jsonwebtoken';

import { environment } from '../../../environments';
import { GitProviderConnectionDao } from '../dao/git-provider-connection.dao';
import { GitProvider } from '../types/git-provider.enum';

const TOKEN_CACHE_TTL_MS = 55 * 60 * 1000; // 55 minutes (tokens last ~1 hour)
const JWT_EXPIRY_SECONDS = 10 * 60; // 10 minutes

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface MappedInstallation {
  id: number;
  account: { login: string; type: string };
}

@Injectable()
export class GitHubAppService {
  private readonly tokenCache = new Map<number, CachedToken>();
  private appSlug: string | null = null;

  constructor(
    private readonly logger: DefaultLogger,
    private readonly gitProviderConnectionDao: GitProviderConnectionDao,
  ) {}

  isConfigured(): boolean {
    return (
      Boolean(environment.githubAppId) &&
      Boolean(environment.githubAppPrivateKey) &&
      Boolean(environment.githubAppClientId) &&
      Boolean(environment.githubAppClientSecret)
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

  async getInstallation(installationId: number): Promise<MappedInstallation> {
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
   *
   * Fallback chain when the user-scoped list is empty:
   * 1. If `userId` provided: look up previously-linked logins from the DB
   *    and query GitHub for each via targeted API calls
   * 2. Return `[]`
   */
  async exchangeCodeAndGetInstallations(
    code: string,
    userId?: string,
    hintedInstallationId?: number,
  ): Promise<MappedInstallation[]> {
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

    this.logger.log('OAuth token exchange succeeded');

    // Get user's installations for this app
    const userOctokit = new Octokit({ auth: tokenData.access_token });

    let userInstallations: MappedInstallation[];

    try {
      const response =
        await userOctokit.apps.listInstallationsForAuthenticatedUser();
      userInstallations = response.data.installations.map((inst) =>
        this.mapInstallation(inst),
      );
      this.logger.log(
        `Found ${userInstallations.length} user-scoped installations: ${userInstallations.map((i) => i.account.login).join(', ') || '(none)'}`,
      );
    } catch (error) {
      this.logger.error(
        `User-scoped listInstallationsForAuthenticatedUser failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException('GITHUB_APP_LIST_INSTALLATIONS_FAILED');
    }

    if (userInstallations.length > 0) {
      return userInstallations;
    }

    if (hintedInstallationId) {
      const hintedInstallation = await this.findInstallationByHint(
        userOctokit,
        hintedInstallationId,
      );
      if (hintedInstallation) {
        return [hintedInstallation];
      }
    }

    // Fallback: targeted lookup by previously-linked logins
    if (userId) {
      const knownInstallations =
        await this.findInstallationsByKnownLogins(userId);
      if (knownInstallations.length > 0) {
        return knownInstallations;
      }
    }

    return [];
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

  /** Invalidate a cached token (e.g. when an installation is deleted). */
  invalidateCachedToken(installationId: number): void {
    this.tokenCache.delete(installationId);
  }

  /**
   * Look up a single installation by account login using the app JWT.
   * Returns null if the app is not installed for that account (404).
   */
  private async findInstallationForLogin(
    login: string,
    accountType: string,
  ): Promise<MappedInstallation | null> {
    try {
      const appJwt = this.generateJwt();
      const octokit = new Octokit({ auth: appJwt });

      const response =
        accountType === 'Organization'
          ? await octokit.apps.getOrgInstallation({ org: login })
          : await octokit.apps.getUserInstallation({ username: login });

      const account = response.data.account;
      return {
        id: response.data.id,
        account: {
          login: account && 'login' in account ? (account.login ?? '') : '',
          type: account && 'type' in account ? (account.type ?? '') : '',
        },
      };
    } catch (error: unknown) {
      const status =
        error instanceof Object && 'status' in error
          ? (error as { status: number }).status
          : undefined;
      if (status !== 404) {
        this.logger.warn(
          `Unexpected error looking up installation for ${login}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * Verify that the authenticated GitHub user can access the hinted installation
   * via the user token before trusting the installation ID from the callback.
   */
  private async findInstallationByHint(
    userOctokit: Octokit,
    installationId: number,
  ): Promise<MappedInstallation | null> {
    try {
      await userOctokit.request(
        'GET /user/installations/{installation_id}/repositories',
        {
          installation_id: installationId,
          per_page: 1,
        },
      );

      return await this.getInstallation(installationId);
    } catch (error) {
      const status =
        error instanceof Object && 'status' in error
          ? (error as { status: number }).status
          : undefined;

      if (status !== 404 && status !== 403) {
        this.logger.warn(
          `Unexpected error validating hinted installation ${installationId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return null;
    }
  }

  /**
   * Query previously-linked logins from the DB and check whether the GitHub App
   * is still installed for each one via targeted API calls.
   */
  private async findInstallationsByKnownLogins(
    userId: string,
  ): Promise<MappedInstallation[]> {
    const connections = await this.gitProviderConnectionDao.getAll({
      userId,
      provider: GitProvider.GitHub,
    });

    if (connections.length === 0) {
      return [];
    }

    // Deduplicate by accountLogin
    const uniqueLogins = new Map<
      string,
      { login: string; accountType: string }
    >();
    for (const conn of connections) {
      if (!uniqueLogins.has(conn.accountLogin)) {
        uniqueLogins.set(conn.accountLogin, {
          login: conn.accountLogin,
          accountType: (conn.metadata['accountType'] as string) || 'User',
        });
      }
    }

    this.logger.log(
      `Targeted lookup for ${uniqueLogins.size} known login(s): ${[...uniqueLogins.keys()].join(', ')}`,
    );

    const results = await Promise.allSettled(
      [...uniqueLogins.values()].map(({ login, accountType }) =>
        this.findInstallationForLogin(login, accountType),
      ),
    );

    const installations: MappedInstallation[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value !== null) {
        installations.push(result.value);
      }
    }

    this.logger.log(
      `Targeted lookup found ${installations.length} active installation(s)`,
    );

    return installations;
  }

  private mapInstallation(inst: {
    id: number;
    account?: Record<string, unknown> | null;
  }): MappedInstallation {
    const account = inst.account;
    return {
      id: inst.id,
      account: {
        login:
          account && 'login' in account && typeof account.login === 'string'
            ? account.login
            : '',
        type:
          account && 'type' in account && typeof account.type === 'string'
            ? account.type
            : '',
      },
    };
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new BadRequestException('GITHUB_APP_NOT_CONFIGURED');
    }
  }
}
