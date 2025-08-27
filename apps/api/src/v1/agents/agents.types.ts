import { DynamicStructuredTool } from '@langchain/core/tools';

import { RuntimeType } from '../runtime/runtime.types';
import { BaseRuntime } from '../runtime/services/base-runtime';

export type AgentTool = (runtime?: BaseRuntime) => DynamicStructuredTool;

export interface PrepareRuntimeParams {
  runtimeType?: RuntimeType;
  runtimeImage?: string;
  gitRepo?: string;
  gitToken?: string;
  workdir?: string;
}

export enum AgentEvent {
  PrepareRuntimeStart = 'prepareRuntimeStart',
  PrepareRuntimeEnd = 'prepareRuntimeEnd',
  WorkflowStart = 'workflowStart',
  WorkflowEnd = 'workflowEnd',
  Message = 'message',
  ToolCallStart = 'toolCall',
}

export type AgentWorkflowEvent = {
  eventType: AgentEvent;
  agentName?: string;
  message?: string;
  toolName?: string;
  toolInput?: Record<string, any>;
  messageContent?: string;
};
