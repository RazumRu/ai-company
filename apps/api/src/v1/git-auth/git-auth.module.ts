import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { GitHubAuthController } from './controllers/github-auth.controller';
import { GitProviderConnectionDao } from './dao/git-provider-connection.dao';
import { GitProviderConnectionEntity } from './entity/git-provider-connection.entity';
import { GitTokenResolverService } from './services/git-token-resolver.service';
import { GitHubAppService } from './services/github-app.service';
import { GitHubAppProviderService } from './services/github-app-provider.service';

@Module({
  imports: [registerEntities([GitProviderConnectionEntity])],
  controllers: [GitHubAuthController],
  providers: [
    GitProviderConnectionDao,
    GitHubAppService,
    GitHubAppProviderService,
    GitTokenResolverService,
  ],
  exports: [
    GitTokenResolverService,
    GitHubAppService,
    GitHubAppProviderService,
    // GitProviderConnectionDao is exported for integration tests that need direct DB seeding/cleanup
    GitProviderConnectionDao,
  ],
})
export class GitAuthModule {}
