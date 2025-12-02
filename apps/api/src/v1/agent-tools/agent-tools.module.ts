import { Module } from '@nestjs/common';

import { GhCloneTool } from './tools/common/github/gh-clone.tool';
import { GhToolGroup } from './tools/common/github/gh-tool-group';
import { WebSearchTool } from './tools/common/web-search.tool';
import { AgentCommunicationTool } from './tools/core/agent-communication.tool';
import { FinishTool } from './tools/core/finish.tool';
import { ShellTool } from './tools/core/shell.tool';

@Module({
  imports: [],
  controllers: [],
  providers: [
    ShellTool,
    WebSearchTool,
    FinishTool,
    AgentCommunicationTool,
    GhCloneTool,
    GhToolGroup,
  ],
  exports: [
    ShellTool,
    WebSearchTool,
    FinishTool,
    AgentCommunicationTool,
    GhCloneTool,
    GhToolGroup,
  ],
})
export class AgentToolsModule {}
