import { forwardRef, Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { GitRepositoriesModule } from '../git-repositories/git-repositories.module';
import { GitHubAppController } from './controllers/github-app.controller';
import { GitHubAppInstallationDao } from './dao/github-app-installation.dao';
import { GitHubAppInstallationEntity } from './entity/github-app-installation.entity';
import { GitHubAppInstallationService } from './services/github-app-installation.service';
import { GitHubAppService } from './services/github-app.service';
import { GitHubTokenResolverService } from './services/github-token-resolver.service';

@Module({
  imports: [
    registerEntities([GitHubAppInstallationEntity]),
    forwardRef(() => GitRepositoriesModule),
  ],
  controllers: [GitHubAppController],
  providers: [
    GitHubAppInstallationDao,
    GitHubAppService,
    GitHubAppInstallationService,
    GitHubTokenResolverService,
  ],
  exports: [
    GitHubTokenResolverService,
    GitHubAppService,
    GitHubAppInstallationService,
    // GitHubAppInstallationDao is exported for integration tests that need direct DB seeding/cleanup
    GitHubAppInstallationDao,
  ],
})
export class GitHubAppModule {}
