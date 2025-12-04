import { ToolRunnableConfig } from '@langchain/core/tools';
import { BadRequestException } from '@packages/common';

import { BaseAgentConfigurable } from '../agents/services/nodes/base-node';
import { RuntimeExecParams } from '../runtime/runtime.types';
import { BaseRuntime } from '../runtime/services/base-runtime';

export const execRuntimeWithContext = async (
  runtime: BaseRuntime | (() => BaseRuntime),
  params: RuntimeExecParams,
  cfg: ToolRunnableConfig<BaseAgentConfigurable>,
) => {
  if (!runtime) {
    throw new BadRequestException(
      undefined,
      'Runtime is required for ShellTool',
    );
  }

  // Get runtime instance (either directly or via getter function)
  const instance = typeof runtime === 'function' ? runtime() : runtime;

  const threadId =
    cfg.configurable?.parent_thread_id ||
    cfg.configurable?.thread_id ||
    'unknown';
  const runId = cfg.configurable?.run_id;

  return instance.exec({
    ...params,
    childWorkdir: `${threadId.replace(/:/g, '_')}`,
    createChildWorkdir: true,
    metadata: {
      threadId,
      runId,
      parentThreadId: cfg.configurable?.parent_thread_id,
    },
  });
};
