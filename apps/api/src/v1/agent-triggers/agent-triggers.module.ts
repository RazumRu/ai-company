import { Module } from '@nestjs/common';

import { GitHubIssuesTrigger } from './services/github-issues-trigger';
import { ManualTrigger } from './services/manual-trigger';

@Module({
  providers: [ManualTrigger, GitHubIssuesTrigger],
  exports: [ManualTrigger, GitHubIssuesTrigger],
})
export class AgentTriggersModule {}
