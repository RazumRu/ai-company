import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OnlyForAuthorized } from '@packages/http-server';

import { environment } from '../../environments';
import { GitHubAppService } from '../git-auth/services/github-app.service';
import {
  AuthConfigResponseDto,
  AuthProviderType,
  SystemSettingsResponseDto,
} from './dto/system.dto';

@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(private readonly gitHubAppService: GitHubAppService) {}

  @Get('settings')
  @ApiBearerAuth()
  @OnlyForAuthorized()
  getSettings(): SystemSettingsResponseDto {
    return {
      githubAppEnabled: this.gitHubAppService.isConfigured(),
    };
  }

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
