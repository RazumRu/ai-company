import { ToolRunnableConfig } from '@langchain/core/tools';
import { BadRequestException } from '@packages/common';
import { z, ZodSchema } from 'zod';

import { BaseAgentConfigurable } from '../agents/services/nodes/base-node';
import { RuntimeExecParams } from '../runtime/runtime.types';
import { BaseRuntime } from '../runtime/services/base-runtime';

// NOTE: Zod v4's `z.toJSONSchema` is overloaded (schema vs registry), so
// `ReturnType<typeof z.toJSONSchema>` resolves to the registry overload.
// Here we only pass around "JSON schema-like" objects.
type JSONSchema = Record<string, unknown>;

export const execRuntimeWithContext = async (
  runtime: BaseRuntime,
  params: RuntimeExecParams,
  cfg: ToolRunnableConfig<BaseAgentConfigurable>,
) => {
  if (!runtime) {
    throw new BadRequestException(
      undefined,
      'Runtime is required for ShellTool',
    );
  }

  /**
   * Tools need a stable per-execution key for persistent shell sessions
   * so cwd/env can persist within the same thread.
   *
   * In normal agent execution we always have thread_id (and often parent_thread_id).
   * In some production call sites, thread ids can be missing while run_id is still present.
   */
  const threadIdFromCfg =
    cfg.configurable?.parent_thread_id || cfg.configurable?.thread_id;
  if (!threadIdFromCfg) {
    throw new BadRequestException(
      undefined,
      'Thread id is required for tool execution',
    );
  }

  const sessionId = threadIdFromCfg;

  return runtime.exec({
    ...params,
    sessionId,
    signal: cfg.signal,
    cwd: params.cwd, // Pass through cwd if provided
    metadata: {
      ...(threadIdFromCfg ? { threadId: threadIdFromCfg } : {}),
      ...(cfg.configurable?.run_id ? { runId: cfg.configurable.run_id } : {}),
      ...(cfg.configurable?.parent_thread_id
        ? { parentThreadId: cfg.configurable.parent_thread_id }
        : {}),
    },
  });
};

/**
 * Converts a Zod schema to a JSON Schema compatible with Ajv draft-07.
 *
 * This helper ensures consistent schema generation across all tools by:
 * - Targeting JSON Schema draft-07 (compatible with Ajv default configuration)
 * - Using `definitions` instead of `$defs` (draft-07 vs 2020-12)
 * - Using `ref` strategy for reused schemas
 *
 * @param zodSchema - The Zod schema to convert
 * @returns A JSON Schema object compatible with Ajv draft-07
 *
 * @example
 * ```ts
 * const schema = z.object({ name: z.string() });
 * const jsonSchema = zodToAjvSchema(schema);
 * ```
 */
export const zodToAjvSchema = (zodSchema: ZodSchema): JSONSchema => {
  return z.toJSONSchema(zodSchema, {
    target: 'draft-7',
    reused: 'ref',
  }) as JSONSchema;
};
