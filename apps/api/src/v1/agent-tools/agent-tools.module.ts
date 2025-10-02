import { Module } from '@nestjs/common';

import { FinishTool } from '../agent-tools/tools/finish.tool';
import { ShellTool } from '../agent-tools/tools/shell.tool';
import { WebSearchTool } from '../agent-tools/tools/web-search.tool';
import { AgentCommunicationTool } from './tools/agent-communication.tool';

@Module({
  imports: [],
  controllers: [],
  providers: [ShellTool, WebSearchTool, FinishTool, AgentCommunicationTool],
  exports: [ShellTool, WebSearchTool, FinishTool, AgentCommunicationTool],
})
export class AgentToolsModule {}
