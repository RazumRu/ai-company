import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BadRequestException } from '@packages/common';
import { CtxStorage, OnlyForAuthorized } from '@packages/http-server';

import { AppContextStorage } from '../../../auth/app-context-storage';

import { environment } from '../../../environments';
import { GitHubAppInstallationDao } from '../dao/github-app-installation.dao';
import {
  LinkInstallationResponseDto,
  ListInstallationsResponseDto,
  OAuthLinkRequestDto,
  SetupInfoResponseDto,
  UnlinkInstallationResponseDto,
} from '../dto/github-app.dto';
import { GitHubAppService } from '../services/github-app.service';

@ApiTags('github-app')
@Controller('github-app')
export class GitHubAppController {
  constructor(
    private readonly gitHubAppService: GitHubAppService,
    private readonly gitHubAppInstallationDao: GitHubAppInstallationDao,
  ) {}

  @Get('setup')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  getSetupInfo(): SetupInfoResponseDto {
    const clientId = environment.githubAppClientId;
    const configured =
      Boolean(clientId) && this.gitHubAppService.isConfigured();

    return {
      installUrl: clientId
        ? `https://github.com/login/oauth/authorize?client_id=${clientId}`
        : '',
      configured,
      callbackPath: '/github-app/callback',
    };
  }

  @Post('oauth/link')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  async linkViaOAuthCode(
    @Body() body: OAuthLinkRequestDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<LinkInstallationResponseDto> {
    const userId = ctx.checkSub();

    const installations =
      await this.gitHubAppService.exchangeCodeAndGetInstallations(body.code);

    if (installations.length === 0) {
      throw new BadRequestException('NO_INSTALLATIONS_FOUND');
    }

    // Link ALL installations the user has access to (personal + org accounts).
    // Previously only the first was linked, causing org installations to be missed.
    for (const installation of installations) {
      try {
        // Verify we can generate a token for it
        await this.gitHubAppService.getInstallationToken(installation.id);

        // Upsert the record
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
      } catch {
        // Skip installations we can't generate tokens for (e.g. suspended).
        // Other installations will still be linked.
      }
    }

    // Return info about the first installation for backward compatibility
    const first = installations[0]!;
    return {
      linked: true,
      accountLogin: first.account.login,
      accountType: first.account.type,
    };
  }

  @Post('installations/:installationId/link')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  async linkInstallation(
    @Param('installationId') installationIdParam: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<LinkInstallationResponseDto> {
    const userId = ctx.checkSub();
    const installationId = Number(installationIdParam);

    if (!Number.isInteger(installationId) || installationId <= 0) {
      throw new BadRequestException('INVALID_INSTALLATION_ID');
    }

    // Verify the installation exists on GitHub
    const installation =
      await this.gitHubAppService.getInstallation(installationId);

    // Verify we can generate a token for it
    await this.gitHubAppService.getInstallationToken(installationId);

    // Upsert the record for this user + installation
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

  @Get('installations')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  async listInstallations(
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ListInstallationsResponseDto> {
    const userId = ctx.checkSub();

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

  @Delete('installations/:installationId')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  async unlinkInstallation(
    @Param('installationId') installationIdParam: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<UnlinkInstallationResponseDto> {
    const userId = ctx.checkSub();
    const installationId = Number(installationIdParam);

    if (!Number.isInteger(installationId) || installationId <= 0) {
      throw new BadRequestException('INVALID_INSTALLATION_ID');
    }

    const existing = await this.gitHubAppInstallationDao.getOne({
      userId,
      installationId,
    });

    if (existing) {
      await this.gitHubAppInstallationDao.updateById(existing.id, {
        isActive: false,
      });
    }

    return { unlinked: true };
  }
}
