import { ToolRunnableConfig } from '@langchain/core/tools';
import { BadRequestException } from '@packages/common';
import { isPlainObject } from 'lodash';
import type { UnknownRecord } from 'type-fest';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../agents/services/nodes/base-node';
import { RuntimeExecParams } from '../runtime/runtime.types';
import { BaseRuntime } from '../runtime/services/base-runtime';

type JSONSchema = ReturnType<typeof z.toJSONSchema>;
type UnknownObject = UnknownRecord;

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
  const sessionId = threadId;

  return instance.exec({
    ...params,
    childWorkdir: `${threadId.replace(/:/g, '_')}`,
    createChildWorkdir: true,
    sessionId,
    signal: cfg.signal,
    metadata: {
      threadId,
      runId,
      parentThreadId: cfg.configurable?.parent_thread_id,
    },
  });
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
