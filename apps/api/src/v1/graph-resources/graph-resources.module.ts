import { Module } from '@nestjs/common';

import { GitAuthModule } from '../git-auth/git-auth.module';
import { GithubResource } from './services/github-resource';

@Module({
  imports: [GitAuthModule],
  providers: [GithubResource],
  exports: [GithubResource],
})
export class GraphResourcesModule {}
