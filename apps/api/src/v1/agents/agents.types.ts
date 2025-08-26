import { DynamicStructuredTool } from '@langchain/core/tools';
import { StateDefinition, StateType } from '@langchain/langgraph';

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
}

export type AgentWorkflowEvent = {
  eventType: AgentEvent;
  eventName: string;
  agentName?: string;
  message?: string;
};

export interface AgentWorkflowOutput<S> {
  runtime: BaseRuntime;
  state: S;
  listener: (cb: (data: AgentWorkflowEvent) => Promise<void>) => void;
}
