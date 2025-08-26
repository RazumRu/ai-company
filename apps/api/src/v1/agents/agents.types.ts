import { DynamicStructuredTool } from '@langchain/core/tools';

import { BaseRuntime } from '../runtime/services/base-runtime';

export type AgentTool = (runtime?: BaseRuntime) => DynamicStructuredTool;
