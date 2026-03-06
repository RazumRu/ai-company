import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { BadRequestException, DefaultLogger } from '@packages/common';

import { environment } from '../../../environments';
import { GitRepositoriesService } from '../../git-repositories/services/git-repositories.service';
import { GitHubAppInstallationDao } from '../dao/github-app-installation.dao';
import type {
  LinkInstallationResponse,
  ListInstallationsResponse,
  SetupInfoResponse,
  UnlinkInstallationResponse,
} from '../dto/github-app.dto';
import { GitHubAppInstallationEntity } from '../entity/github-app-installation.entity';
import { GitHubAppService } from './github-app.service';

@Injectable()
export class GitHubAppInstallationService {
  constructor(
    private readonly gitHubAppService: GitHubAppService,
    private readonly gitHubAppInstallationDao: GitHubAppInstallationDao,
    private readonly logger: DefaultLogger,
    @Inject(forwardRef(() => GitRepositoriesService))
    private readonly gitRepositoriesService: GitRepositoriesService,
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
  ): Promise<LinkInstallationResponse> {
    const installations =
      await this.gitHubAppService.exchangeCodeAndGetInstallations(code);

    if (installations.length === 0) {
      throw new BadRequestException('NO_INSTALLATIONS_FOUND');
    }

    let firstLinked: { accountLogin: string; accountType: string } | null =
      null;

    for (const installation of installations) {
      try {
        await this.gitHubAppService.getInstallationToken(installation.id);

        const existing = await this.gitHubAppInstallationDao.getOne({
          userId,
          installationId: installation.id,
        });

        if (existing) {
          await this.gitHubAppInstallationDao.updateById(existing.id, {
            accountLogin: installation.account.login,
            accountType: installation.account.type,
            isActive: true,
          });
        } else {
          await this.gitHubAppInstallationDao.create({
            userId,
            installationId: installation.id,
            accountLogin: installation.account.login,
            accountType: installation.account.type,
            isActive: true,
          });
        }

        if (!firstLinked) {
          firstLinked = {
            accountLogin: installation.account.login,
            accountType: installation.account.type,
          };
        }
      } catch {
        // Skip installations we can't generate tokens for (e.g. suspended).
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

  async linkInstallation(
    userId: string,
    installationId: number,
  ): Promise<LinkInstallationResponse> {
    if (!Number.isInteger(installationId) || installationId <= 0) {
      throw new BadRequestException('INVALID_INSTALLATION_ID');
    }

    const installation =
      await this.gitHubAppService.getInstallation(installationId);

    await this.gitHubAppService.getInstallationToken(installationId);

    const existing = await this.gitHubAppInstallationDao.getOne({
      userId,
      installationId,
    });

    if (existing) {
      await this.gitHubAppInstallationDao.updateById(existing.id, {
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        isActive: true,
      });
    } else {
      await this.gitHubAppInstallationDao.create({
        userId,
        installationId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        isActive: true,
      });
    }

    return {
      linked: true,
      accountLogin: installation.account.login,
      accountType: installation.account.type,
    };
  }

  async listInstallations(userId: string): Promise<ListInstallationsResponse> {
    const installations = await this.gitHubAppInstallationDao.getAll({
      userId,
      isActive: true,
      order: { createdAt: 'DESC' },
    });

    return {
      installations: installations.map((inst) => ({
        id: inst.id,
        installationId: inst.installationId,
        accountLogin: inst.accountLogin,
        accountType: inst.accountType,
        isActive: inst.isActive,
        createdAt: new Date(inst.createdAt).toISOString(),
      })),
    };
  }

  async getActiveInstallations(userId: string): Promise<GitHubAppInstallationEntity[]> {
    return this.gitHubAppInstallationDao.getAll({ userId, isActive: true });
  }

  async getInstallationToken(installationId: number): Promise<string> {
    return this.gitHubAppService.getInstallationToken(installationId);
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

    const existing = await this.gitHubAppInstallationDao.getOne({
      userId,
      installationId,
    });

    if (existing) {
      try {
        await this.gitHubAppService.deleteInstallation(installationId);
      } catch (error) {
        this.logger.warn(
          `Failed to delete installation ${installationId} from GitHub: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await this.gitHubAppInstallationDao.updateById(existing.id, {
        isActive: false,
      });
      await this.gitRepositoriesService.deleteRepositoriesByInstallationIds(
        userId,
        [installationId],
      );
    }

    return { unlinked: true };
  }

  async disconnectAll(userId: string): Promise<UnlinkInstallationResponse> {
    const installations = await this.gitHubAppInstallationDao.getAll({
      userId,
      isActive: true,
    });

    const deactivatedInstallationIds: number[] = [];

    for (const inst of installations) {
      try {
        await this.gitHubAppService.deleteInstallation(inst.installationId);
      } catch (error) {
        this.logger.warn(
          `Failed to delete installation ${inst.installationId} from GitHub: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await this.gitHubAppInstallationDao.updateById(inst.id, {
        isActive: false,
      });
      deactivatedInstallationIds.push(inst.installationId);
    }

    await this.gitRepositoriesService.deleteRepositoriesByInstallationIds(
      userId,
      deactivatedInstallationIds,
    );

    return { unlinked: true };
  }
}
