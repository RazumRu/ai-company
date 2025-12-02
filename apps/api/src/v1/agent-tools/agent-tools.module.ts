import { Module } from '@nestjs/common';

import { GhBranchTool } from './tools/common/github/gh-branch.tool';
import { GhCloneTool } from './tools/common/github/gh-clone.tool';
import { GhCommitTool } from './tools/common/github/gh-commit.tool';
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
    GhCommitTool,
    GhBranchTool,
    GhToolGroup,
  ],
  exports: [
    ShellTool,
    WebSearchTool,
    FinishTool,
    AgentCommunicationTool,
    GhCloneTool,
    GhCommitTool,
    GhBranchTool,
    GhToolGroup,
  ],
})
export class AgentToolsModule {}
