import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OnlyForAuthorized } from '@packages/http-server';

import { GitHubAppService } from '../github-app/services/github-app.service';
import { SystemSettingsResponseDto } from './dto/system.dto';

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
}
