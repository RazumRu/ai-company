import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { IContextData } from '@packages/http-server';
import { CtxData, OnlyForAuthorized } from '@packages/http-server';

import { environment } from '../../environments';
import { GitHubAppService } from '../git-auth/services/github-app.service';
import {
  AuthConfigResponseDto,
  AuthProviderType,
  SystemSettingsResponseDto,
} from './dto/system.dto';

const API_VERSION = (
  JSON.parse(
    readFileSync(resolve(__dirname, '../../../package.json'), 'utf-8'),
  ) as { version: string }
).version;

const WEB_VERSION = (
  JSON.parse(
    readFileSync(resolve(__dirname, '../../../../web/package.json'), 'utf-8'),
  ) as { version: string }
).version;

@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(private readonly gitHubAppService: GitHubAppService) {}

  @Get('settings')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  getSettings(@CtxData() ctx: IContextData): SystemSettingsResponseDto {
    return {
      githubAppEnabled: this.gitHubAppService.isConfigured(),
      litellmManagementEnabled: environment.litellmManagementEnabled === true,
      isAdmin:
        Array.isArray(ctx.roles) && ctx.roles.includes(environment.adminRole),
      githubWebhookEnabled: Boolean(environment.githubWebhookSecret),
      apiVersion: API_VERSION,
      webVersion: WEB_VERSION,
    };
  }

  /**
   * Public endpoint (no @OnlyForAuthorized) — intentionally unauthenticated.
   * Returns OIDC provider config needed by the frontend before login.
   * Only expose non-sensitive values here (provider type, issuer URL, client ID).
   */
  @Get('config')
  getAuthConfig(): AuthConfigResponseDto {
    const isZitadel = environment.authProvider === 'zitadel';
    return {
      provider: isZitadel
        ? AuthProviderType.Zitadel
        : AuthProviderType.Keycloak,
      issuer: isZitadel
        ? environment.zitadelIssuer
        : `${environment.keycloakUrl}/realms/${environment.keycloakRealm}`,
      clientId: isZitadel
        ? environment.zitadelClientId
        : environment.keycloakClientId,
    };
  }
}
