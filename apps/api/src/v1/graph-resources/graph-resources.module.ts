import { Module } from '@nestjs/common';

import { GithubResource } from './services/github-resource';

@Module({
  providers: [GithubResource],
  exports: [GithubResource],
})
export class GraphResourcesModule {}
