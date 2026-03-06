import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, DefaultLogger } from '@packages/common';

import { environment } from '../../../environments';
import { GitProviderConnectionDao } from '../dao/git-provider-connection.dao';
import type {
  LinkInstallationResponse,
  ListInstallationsResponse,
  SetupInfoResponse,
  UnlinkInstallationResponse,
} from '../dto/git-auth.dto';
import { GitProviderConnectionEntity } from '../entity/git-provider-connection.entity';
import { GitProvider } from '../types/git-provider.enum';
import {
  INSTALLATION_UNLINKED_EVENT,
  InstallationUnlinkedEvent,
} from '../types/installation-unlinked.event';
import { GitHubAppService } from './github-app.service';

@Injectable()
export class GitHubAppProviderService {
  constructor(
    private readonly gitHubAppService: GitHubAppService,
    private readonly gitProviderConnectionDao: GitProviderConnectionDao,
    private readonly logger: DefaultLogger,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getSetupInfo(): Promise<SetupInfoResponse> {
    const clientId = environment.githubAppClientId;
    const configured =
      Boolean(clientId) && this.gitHubAppService.isConfigured();

    let newInstallationUrl = '';
    if (configured) {
      const slug = await this.gitHubAppService.getAppSlug();
      if (slug) {
        newInstallationUrl = `https://github.com/apps/${slug}/installations/new`;
      }
    }

    return {
      installUrl: clientId
        ? `https://github.com/login/oauth/authorize?client_id=${clientId}`
        : '',
      newInstallationUrl,
      configured,
      callbackPath: '/github-app/callback',
    };
  }

  async linkViaOAuthCode(
    userId: string,
    code: string,
    installationId?: number,
  ): Promise<LinkInstallationResponse> {
    this.logger.log(
      `Exchanging OAuth code for installations (code length: ${code.length}${installationId !== undefined ? `, installationId hint: ${installationId}` : ''})`,
    );

    const installations =
      await this.gitHubAppService.exchangeCodeAndGetInstallations(
        code,
        installationId,
      );

    this.logger.log(
      `Received ${installations.length} installations from OAuth code exchange`,
    );

    if (installations.length === 0) {
      this.logger.warn(
        `No installations found for user ${userId} after OAuth code exchange`,
      );
      throw new BadRequestException('NO_INSTALLATIONS_FOUND');
    }

    let firstLinked: { accountLogin: string; accountType: string } | null =
      null;

    for (const installation of installations) {
      this.logger.log(
        `Processing installation ${installation.id} (account: ${installation.account.login})`,
      );
      try {
        await this.gitHubAppService.getInstallationToken(installation.id);

        const existing = await this.gitProviderConnectionDao.getOne({
          userId,
          provider: GitProvider.GitHub,
          accountLogin: installation.account.login,
        });

        if (existing) {
          await this.gitProviderConnectionDao.updateById(existing.id, {
            metadata: {
              installationId: installation.id,
              accountType: installation.account.type,
            },
            isActive: true,
          });
        } else {
          await this.gitProviderConnectionDao.create({
            userId,
            provider: GitProvider.GitHub,
            accountLogin: installation.account.login,
            metadata: {
              installationId: installation.id,
              accountType: installation.account.type,
            },
            isActive: true,
          });
        }

        if (!firstLinked) {
          firstLinked = {
            accountLogin: installation.account.login,
            accountType: installation.account.type,
          };
        }
      } catch (error) {
        this.logger.warn(
          `Skipping installation ${installation.id} (${installation.account.login}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (!firstLinked) {
      throw new BadRequestException('NO_ACCESSIBLE_INSTALLATIONS');
    }

    return {
      linked: true,
      ...firstLinked,
    };
  }

  async listInstallations(userId: string): Promise<ListInstallationsResponse> {
    const connections = await this.gitProviderConnectionDao.getAll({
      userId,
      provider: GitProvider.GitHub,
      isActive: true,
      order: { createdAt: 'DESC' },
    });

    const alive: GitProviderConnectionEntity[] = [];

    for (const conn of connections) {
      const installationId = conn.metadata['installationId'] as number;
      // Clear cached token so we always hit GitHub to verify the installation is still valid
      this.gitHubAppService.invalidateCachedToken(installationId);
      try {
        await this.gitHubAppService.getInstallationToken(installationId);
        alive.push(conn);
      } catch {
        this.logger.warn(
          `Installation ${installationId} (${conn.accountLogin}) is no longer valid, deactivating`,
        );
        await this.deactivateByInstallationId(userId, installationId);
      }
    }

    return {
      installations: alive.map((conn) => ({
        id: conn.id,
        installationId: (conn.metadata['installationId'] as number) ?? 0,
        accountLogin: conn.accountLogin,
        accountType: (conn.metadata['accountType'] as string) ?? '',
        isActive: conn.isActive,
        createdAt: new Date(conn.createdAt).toISOString(),
      })),
    };
  }

  async getActiveInstallations(
    userId: string,
  ): Promise<GitProviderConnectionEntity[]> {
    return this.gitProviderConnectionDao.getAll({
      userId,
      provider: GitProvider.GitHub,
      isActive: true,
    });
  }

  isConfigured(): boolean {
    return this.gitHubAppService.isConfigured();
  }

  async unlinkInstallation(
    userId: string,
    installationId: number,
  ): Promise<UnlinkInstallationResponse> {
    if (!Number.isInteger(installationId) || installationId <= 0) {
      throw new BadRequestException('INVALID_INSTALLATION_ID');
    }

    // Find the connection by matching the installationId stored in metadata.
    // We query all GitHub connections for this user and filter by metadata.
    const connections = await this.gitProviderConnectionDao.getAll({
      userId,
      provider: GitProvider.GitHub,
    });

    const existing = connections.find(
      (c) => c.metadata['installationId'] === installationId,
    );

    if (existing) {
      try {
        await this.gitHubAppService.deleteInstallation(installationId);
      } catch (error) {
        this.logger.warn(
          `Failed to delete installation ${installationId} from GitHub: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await this.gitProviderConnectionDao.updateById(existing.id, {
        isActive: false,
      });

      const githubInstallationId = existing.metadata[
        'installationId'
      ] as number;
      this.eventEmitter.emit(INSTALLATION_UNLINKED_EVENT, {
        userId,
        provider: GitProvider.GitHub,
        connectionIds: [existing.id],
        accountLogins: [existing.accountLogin],
        githubInstallationIds: [githubInstallationId],
      } satisfies InstallationUnlinkedEvent);
    }

    return { unlinked: true };
  }

  /**
   * Deactivate a connection by GitHub installation ID without calling GitHub's
   * delete API (the installation is already gone on GitHub's side).
   * Emits INSTALLATION_UNLINKED_EVENT so downstream listeners clean up repos.
   */
  async deactivateByInstallationId(
    userId: string,
    installationId: number,
  ): Promise<void> {
    const connections = await this.gitProviderConnectionDao.getAll({
      userId,
      provider: GitProvider.GitHub,
    });

    const existing = connections.find(
      (c) => c.metadata['installationId'] === installationId,
    );

    if (!existing) {
      return;
    }

    await this.gitProviderConnectionDao.updateById(existing.id, {
      isActive: false,
    });

    this.eventEmitter.emit(INSTALLATION_UNLINKED_EVENT, {
      userId,
      provider: GitProvider.GitHub,
      connectionIds: [existing.id],
      accountLogins: [existing.accountLogin],
      githubInstallationIds: [installationId],
    } satisfies InstallationUnlinkedEvent);
  }

  async disconnectAll(userId: string): Promise<UnlinkInstallationResponse> {
    const connections = await this.gitProviderConnectionDao.getAll({
      userId,
      provider: GitProvider.GitHub,
      isActive: true,
    });

    const connectionIds: string[] = [];
    const accountLogins: string[] = [];
    const githubInstallationIds: number[] = [];

    for (const conn of connections) {
      const installationId = conn.metadata['installationId'] as number;
      try {
        await this.gitHubAppService.deleteInstallation(installationId);
      } catch (error) {
        this.logger.warn(
          `Failed to delete installation ${installationId} from GitHub: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await this.gitProviderConnectionDao.updateById(conn.id, {
        isActive: false,
      });
      connectionIds.push(conn.id);
      accountLogins.push(conn.accountLogin);
      githubInstallationIds.push(installationId);
    }

    this.eventEmitter.emit(INSTALLATION_UNLINKED_EVENT, {
      userId,
      provider: GitProvider.GitHub,
      connectionIds,
      accountLogins,
      githubInstallationIds,
    } satisfies InstallationUnlinkedEvent);

    return { unlinked: true };
  }
}
