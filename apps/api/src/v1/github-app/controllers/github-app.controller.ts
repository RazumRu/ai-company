import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CtxStorage, OnlyForAuthorized } from '@packages/http-server';

import { AppContextStorage } from '../../../auth/app-context-storage';
import {
  LinkInstallationResponseDto,
  ListInstallationsResponseDto,
  OAuthLinkRequestDto,
  SetupInfoResponseDto,
  UnlinkInstallationResponseDto,
} from '../dto/github-app.dto';
import { GitHubAppInstallationService } from '../services/github-app-installation.service';

@ApiTags('github-app')
@Controller('github-app')
export class GitHubAppController {
  constructor(
    private readonly gitHubAppInstallationService: GitHubAppInstallationService,
  ) {}

  @Get('setup')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  async getSetupInfo(): Promise<SetupInfoResponseDto> {
    return this.gitHubAppInstallationService.getSetupInfo();
  }

  @Post('oauth/link')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  async linkViaOAuthCode(
    @Body() body: OAuthLinkRequestDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<LinkInstallationResponseDto> {
    const userId = ctx.checkSub();
    return this.gitHubAppInstallationService.linkViaOAuthCode(
      userId,
      body.code,
    );
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
    return this.gitHubAppInstallationService.linkInstallation(
      userId,
      installationId,
    );
  }

  @Get('installations')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  async listInstallations(
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ListInstallationsResponseDto> {
    const userId = ctx.checkSub();
    return this.gitHubAppInstallationService.listInstallations(userId);
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
    return this.gitHubAppInstallationService.unlinkInstallation(
      userId,
      installationId,
    );
  }

  @Delete('disconnect')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  async disconnectAll(
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<UnlinkInstallationResponseDto> {
    const userId = ctx.checkSub();
    return this.gitHubAppInstallationService.disconnectAll(userId);
  }
}
