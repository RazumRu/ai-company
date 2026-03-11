import { ToolRunnableConfig } from '@langchain/core/tools';
import { BadRequestException } from '@packages/common';
import { z, ZodSchema } from 'zod';

import { BaseAgentConfigurable } from '../agents/agents.types';
import { RuntimeExecParams } from '../runtime/runtime.types';
import { BaseRuntime } from '../runtime/services/base-runtime';

// NOTE: Zod v4's `z.toJSONSchema` is overloaded (schema vs registry), so
// `ReturnType<typeof z.toJSONSchema>` resolves to the registry overload.
// Here we only pass around "JSON schema-like" objects.
type JSONSchema = Record<string, unknown>;

export interface ExecRuntimeOptions {
  /**
   * When true, the command runs inside a persistent shell session keyed by
   * the thread id so that cwd / env changes persist across calls.
   * Only the `shell` tool should set this to true — all other tools
   * (gh_*, files_*, subagents, etc.) should use one-shot execution to
   * avoid broken-pipe errors when multiple tools run in parallel.
   *
   * @default false
   */
  useSession?: boolean;
}

export const execRuntimeWithContext = async (
  runtime: BaseRuntime,
  params: RuntimeExecParams,
  cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  options?: ExecRuntimeOptions,
) => {
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

  const useSession = options?.useSession ?? false;

  return runtime.exec({
    ...params,
    ...(useSession ? { sessionId: threadIdFromCfg } : {}),
    signal: cfg.signal,
    metadata: {
      threadId: threadIdFromCfg,
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
