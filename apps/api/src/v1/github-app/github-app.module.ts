import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { GitHubAppController } from './controllers/github-app.controller';
import { GitHubAppInstallationDao } from './dao/github-app-installation.dao';
import { GitHubAppInstallationEntity } from './entity/github-app-installation.entity';
import { GitHubAppService } from './services/github-app.service';
import { GitHubTokenResolverService } from './services/github-token-resolver.service';

@Module({
  imports: [registerEntities([GitHubAppInstallationEntity])],
  controllers: [GitHubAppController],
  providers: [
    GitHubAppInstallationDao,
    GitHubAppService,
    GitHubTokenResolverService,
  ],
  exports: [GitHubTokenResolverService, GitHubAppService, GitHubAppInstallationDao],
})
export class GitHubAppModule {}
