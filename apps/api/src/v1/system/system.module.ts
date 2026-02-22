import { Module } from '@nestjs/common';

import { GitHubAppModule } from '../github-app/github-app.module';
import { SystemController } from './system.controller';

@Module({
  imports: [GitHubAppModule],
  controllers: [SystemController],
})
export class SystemModule {}
