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
} from '../dto/git-auth.dto';
import { GitHubAppProviderService } from '../services/github-app-provider.service';

@ApiTags('git-auth')
@Controller('git-auth/github')
export class GitHubAuthController {
  constructor(
    private readonly gitHubAppProviderService: GitHubAppProviderService,
  ) {}

  @Get('setup')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  async getSetupInfo(): Promise<SetupInfoResponseDto> {
    return this.gitHubAppProviderService.getSetupInfo();
  }

  @Post('oauth/link')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  async linkViaOAuthCode(
    @Body() body: OAuthLinkRequestDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<LinkInstallationResponseDto> {
    const userId = ctx.checkSub();
    return this.gitHubAppProviderService.linkViaOAuthCode(
      userId,
      body.code,
      body.installationId,
    );
  }

  @Get('installations')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  async listInstallations(
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ListInstallationsResponseDto> {
    const userId = ctx.checkSub();
    return this.gitHubAppProviderService.listInstallations(userId);
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
    return this.gitHubAppProviderService.unlinkInstallation(
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
    return this.gitHubAppProviderService.disconnectAll(userId);
  }
}
