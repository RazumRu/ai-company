import { ToolRunnableConfig } from '@langchain/core/tools';
import { BadRequestException } from '@packages/common';
import { z } from 'zod';

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

type SchemaDef = {
  typeName?: string;
  innerType?: z.ZodTypeAny;
  schema?: z.ZodTypeAny;
  description?: string;
};

const getTypeName = (schema: z.ZodTypeAny): string | undefined =>
  (schema as { _def?: SchemaDef })._def?.typeName;

const unwrapObjectSchema = (
  schema: z.ZodTypeAny,
): z.ZodObject<Record<string, z.ZodTypeAny>> | null => {
  let current: z.ZodTypeAny | undefined = schema;

  while (current) {
    const typeName = getTypeName(current);

    if (typeName === 'ZodObject') {
      return current as z.ZodObject<Record<string, z.ZodTypeAny>>;
    }

    if (typeName === 'ZodEffects') {
      current = (current as { _def?: SchemaDef })._def?.schema;
      continue;
    }

    if (
      typeName === 'ZodOptional' ||
      typeName === 'ZodNullable' ||
      typeName === 'ZodDefault'
    ) {
      current = (current as { _def?: SchemaDef })._def?.innerType;
      continue;
    }

    return null;
  }

  return null;
};

const unwrapFieldSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  let current: z.ZodTypeAny | undefined = schema;

  while (current) {
    const typeName = getTypeName(current);

    if (
      typeName === 'ZodOptional' ||
      typeName === 'ZodNullable' ||
      typeName === 'ZodDefault'
    ) {
      current = (current as { _def?: SchemaDef })._def?.innerType;
      continue;
    }

    if (typeName === 'ZodEffects') {
      current = (current as { _def?: SchemaDef })._def?.schema;
      continue;
    }

    return current;
  }

  return schema;
};

const isOptionalField = (schema: z.ZodTypeAny): boolean => {
  let current: z.ZodTypeAny | undefined = schema;

  while (current) {
    const typeName = getTypeName(current);

    if (
      typeName === 'ZodOptional' ||
      typeName === 'ZodNullable' ||
      typeName === 'ZodDefault'
    ) {
      return true;
    }

    if (typeName === 'ZodEffects') {
      current = (current as { _def?: SchemaDef })._def?.schema;
      continue;
    }

    return false;
  }

  return false;
};

const getFieldDescription = (schema: z.ZodTypeAny): string => {
  const baseField = unwrapFieldSchema(schema);
  const def = (baseField as { _def?: SchemaDef })._def;
  return def?.description ?? 'No description';
};

export const getSchemaParameterDocs = (schema: z.ZodTypeAny) => {
  const objectSchema = unwrapObjectSchema(schema);

  if (!objectSchema) {
    return '';
  }

  const shape = objectSchema.shape;
  const params: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    const description = getFieldDescription(field);
    const optional = isOptionalField(field);

    params.push(`#### \`${key}\``);
    params.push(`${optional ? '(optional) ' : '(required) '}${description}`);
    params.push('');
  }

  if (params.length === 0) {
    return '';
  }

  return `### Parameters\n\n${params.join('\n')}`;
};
