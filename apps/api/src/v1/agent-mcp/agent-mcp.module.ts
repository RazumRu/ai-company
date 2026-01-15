import { Module } from '@nestjs/common';

import { FilesystemMcp } from './services/mcp/filesystem-mcp';
import { JiraMcp } from './services/mcp/jira-mcp';
import { PlaywrightMcp } from './services/mcp/playwright-mcp';

@Module({
  providers: [FilesystemMcp, JiraMcp, PlaywrightMcp],
  exports: [FilesystemMcp, JiraMcp, PlaywrightMcp],
})
export class AgentMcpModule {}
