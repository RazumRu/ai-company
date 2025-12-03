import { ToolRunnableConfig } from '@langchain/core/tools';

import { AgentOutput } from '../../../../agents/services/agents/base-agent';
import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';

export interface AgentInfo {
  name: string;
  description: string;
  invokeAgent: <T = AgentOutput>(
    messages: string[],
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ) => Promise<T>;
}

export type BaseCommunicationToolConfig = {
  agents: AgentInfo[];
};
