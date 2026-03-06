import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import {
  BadRequestException,
  DefaultLogger,
  ForbiddenException,
} from '@packages/common';
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
   *
   * When `installationIdHint` is provided and all other discovery methods return empty,
   * fetches that specific installation via the app JWT and verifies the user has access
   * (user login or org membership must match the installation's account login).
   */
  async exchangeCodeAndGetInstallations(
    code: string,
    installationIdHint?: number,
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

    this.logger.log('OAuth token exchange succeeded');

    // Get user's installations for this app
    const userOctokit = new Octokit({ auth: tokenData.access_token });

    let userInstallations: {
      id: number;
      account: { login: string; type: string };
    }[] = [];

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

    // Fallback: use app-level JWT to list all installations of the app,
    // filtered to only those belonging to the authenticated user's orgs or personal account.
    // This handles the case where the user installed the app via a new tab
    // without completing the OAuth user-authorization flow.
    this.logger.warn(
      'User-scoped installation list empty, falling back to app-level list',
    );

    // Resolve user identity and org memberships (needed for both fallback strategies)
    const allowedLogins = await this.resolveAllowedLogins(userOctokit);

    try {
      const appJwt = this.generateJwt();
      const appOctokit = new Octokit({ auth: appJwt });
      const response = await appOctokit.apps.listInstallations();

      this.logger.log(
        `Total app installations: ${response.data.length}, accounts: ${response.data.map((i) => (i.account && 'login' in i.account ? String(i.account.login) : '(unknown)')).join(', ') || '(none)'}`,
      );

      const filtered = response.data
        .filter((inst) => {
          const login = inst.account && 'login' in inst.account
            ? String(inst.account.login)
            : '';
          return login !== '' && allowedLogins.has(login.toLowerCase());
        })
        .map((inst) => this.mapInstallation(inst));

      this.logger.log(
        `Filtered to ${filtered.length} installations matching user orgs`,
      );

      if (filtered.length > 0) {
        return filtered;
      }
    } catch (error) {
      this.logger.error(
        `App-level listInstallations fallback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Final fallback: if an installationId hint was provided, verify it directly
    if (installationIdHint !== undefined) {
      return this.verifyHintedInstallation(installationIdHint, allowedLogins);
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

  /**
   * Resolve the set of GitHub logins (lowercase) that the authenticated user
   * is allowed to access — their own login plus all org memberships.
   */
  private async resolveAllowedLogins(
    userOctokit: Octokit,
  ): Promise<Set<string>> {
    const [userOrgsResponse, authenticatedUserResponse] = await Promise.all([
      userOctokit.orgs.listForAuthenticatedUser(),
      userOctokit.users.getAuthenticated(),
    ]);

    const userLogin = authenticatedUserResponse.data.login;
    const userOrgs = userOrgsResponse.data.map((org) => org.login);
    this.logger.log(`Authenticated user: ${userLogin}`);
    this.logger.log(`User orgs: ${userOrgs.join(', ') || '(none)'}`);

    const allowedLogins = new Set(
      userOrgs.map((login) => login.toLowerCase()),
    );
    allowedLogins.add(userLogin.toLowerCase());
    this.logger.log(`Allowed logins: ${[...allowedLogins].join(', ')}`);

    return allowedLogins;
  }

  /**
   * Verify a specific installation ID hint by fetching it via app JWT and
   * checking the account login against the user's allowed logins.
   */
  private async verifyHintedInstallation(
    installationId: number,
    allowedLogins: Set<string>,
  ): Promise<{ id: number; account: { login: string; type: string } }[]> {
    this.logger.log(
      `Using provided installationId hint: ${installationId}`,
    );

    try {
      const installation = await this.getInstallation(installationId);
      const installationLogin = installation.account.login.toLowerCase();

      this.logger.log(
        `Hinted installation ${installationId} belongs to account: ${installation.account.login}`,
      );

      if (!allowedLogins.has(installationLogin)) {
        this.logger.warn(
          `User does not have access to installation ${installationId} (account: ${installation.account.login}). Allowed logins: ${[...allowedLogins].join(', ')}`,
        );
        throw new ForbiddenException(
          'INSTALLATION_ACCESS_DENIED',
        );
      }

      this.logger.log(
        `Verified user access to hinted installation ${installationId} (account: ${installation.account.login})`,
      );

      return [installation];
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(
        `Failed to verify hinted installation ${installationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private mapInstallation(inst: {
    id: number;
    account?: Record<string, unknown> | null;
  }): { id: number; account: { login: string; type: string } } {
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
