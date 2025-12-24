import { Module } from '@nestjs/common';

import { FilesystemMcp } from './services/mcp/filesystem-mcp';
import { JiraMcp } from './services/mcp/jira-mcp';

@Module({
  providers: [FilesystemMcp, JiraMcp],
  exports: [FilesystemMcp, JiraMcp],
})
export class AgentMcpModule {}
