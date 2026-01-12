import { ToolRunnableConfig } from '@langchain/core/tools';
import { BadRequestException } from '@packages/common';
import { isPlainObject } from 'lodash';
import type { UnknownRecord } from 'type-fest';
import { z, ZodSchema } from 'zod';

import { BaseAgentConfigurable } from '../agents/services/nodes/base-node';
import { RuntimeExecParams } from '../runtime/runtime.types';
import { BaseRuntime } from '../runtime/services/base-runtime';

// NOTE: Zod v4's `z.toJSONSchema` is overloaded (schema vs registry), so
// `ReturnType<typeof z.toJSONSchema>` resolves to the registry overload.
// Here we only pass around "JSON schema-like" objects.
type JSONSchema = Record<string, unknown>;
type UnknownObject = UnknownRecord;

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
   * Tools need a stable per-execution key for:
   * - child workdir isolation under /runtime-workspace/<key>
   * - persistent shell session id (so cwd/env can persist within the same thread)
   *
   * In normal agent execution we always have thread_id (and often parent_thread_id).
   * In some production call sites, thread ids can be missing while run_id is still present.
   * Falling back to a shared "unknown" workdir/session causes cross-run contamination and
   * can make filesystem scans (e.g. ripgrep) unexpectedly slow enough to hit tail timeouts.
   */
  const threadIdFromCfg =
    cfg.configurable?.parent_thread_id || cfg.configurable?.thread_id;
  const runId = cfg.configurable?.run_id;
  const executionKey = threadIdFromCfg || runId || 'unknown';
  const sessionId = executionKey;

  // Make it safe as a single path segment.
  const childWorkdir = executionKey
    .replace(/:/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_');

  return runtime.exec({
    ...params,
    childWorkdir,
    createChildWorkdir: true,
    sessionId,
    signal: cfg.signal,
    cwd: params.cwd, // Pass through cwd if provided
    metadata: {
      ...(threadIdFromCfg ? { threadId: threadIdFromCfg } : {}),
      ...(runId ? { runId } : {}),
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

export const getSchemaParameterDocs = (jsonSchema: JSONSchema) => {
  // z.toJSONSchema returns a direct JSON schema object
  const schema = jsonSchema as {
    type?: string;
    properties?: Record<
      string,
      { description?: string; [key: string]: unknown }
    >;
    required?: string[];
  };

  if (schema.type !== 'object' || !schema.properties) {
    return '';
  }

  const params: string[] = [];
  const required = new Set(schema.required || []);

  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    const description = fieldSchema.description || 'No description';
    const isRequired = required.has(key);

    params.push(`#### \`${key}\``);
    params.push(`${isRequired ? '(required) ' : '(optional) '}${description}`);
    params.push('');
  }

  if (params.length === 0) {
    return '';
  }

  return `### Parameters\n\n${params.join('\n')}`;
};

const hasDefault = (schema: unknown): boolean => {
  if (!isPlainObject(schema)) return false;
  const obj = schema as UnknownObject;
  if ('default' in obj) return true;

  const keys = [
    'allOf',
    'anyOf',
    'oneOf',
    'not',
    'items',
    'properties',
    'additionalProperties',
  ];
  for (const k of keys) {
    const v = obj[k];
    if (!v) continue;
    if (Array.isArray(v)) {
      if (v.some(hasDefault)) return true;
    } else if (isPlainObject(v)) {
      if (k === 'properties') {
        if (Object.values(v).some(hasDefault)) return true;
      } else if (hasDefault(v)) return true;
    }
  }
  return false;
};

const fixRequiredWithDefaultsInternal = (schema: unknown): unknown => {
  if (Array.isArray(schema)) {
    return schema.map(fixRequiredWithDefaultsInternal);
  }

  if (!isPlainObject(schema)) {
    return schema;
  }

  // Clone + recurse first (keep function pure, avoid mutating shared schema objects)
  const next: UnknownObject = {};
  for (const [k, v] of Object.entries(schema as UnknownObject)) {
    next[k] = fixRequiredWithDefaultsInternal(v);
  }

  if (
    next.type === 'object' &&
    isPlainObject(next.properties) &&
    Array.isArray(next.required)
  ) {
    const props = next.properties as UnknownObject;
    const requiredKeys = next.required.filter(
      (k): k is string => typeof k === 'string' && !hasDefault(props[k]),
    );

    if (requiredKeys.length) {
      next.required = requiredKeys;
    } else {
      delete next.required;
    }
  }

  return next;
};

export const fixRequiredWithDefaults = <TSchema extends JSONSchema>(
  schema: TSchema,
): TSchema => fixRequiredWithDefaultsInternal(schema) as TSchema;
