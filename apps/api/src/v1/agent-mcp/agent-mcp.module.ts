import { Module } from '@nestjs/common';

import { CustomMcp } from './services/mcp/custom-mcp';
import { FilesystemMcp } from './services/mcp/filesystem-mcp';
import { JiraMcp } from './services/mcp/jira-mcp';
import { PlaywrightMcp } from './services/mcp/playwright-mcp';

@Module({
  providers: [CustomMcp, FilesystemMcp, JiraMcp, PlaywrightMcp],
  exports: [CustomMcp, FilesystemMcp, JiraMcp, PlaywrightMcp],
})
export class AgentMcpModule {}
