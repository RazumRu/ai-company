import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { RuntimeInstanceStatus, RuntimeType } from '../runtime.types';

export const GetRuntimesQuerySchema = z.object({
  threadId: z.string().uuid().describe('Filter by thread ID'),
  status: z
    .nativeEnum(RuntimeInstanceStatus)
    .optional()
    .describe('Filter by runtime instance status'),
});

export const RuntimeInstanceSchema = z.object({
  id: z.string().uuid().describe('Runtime instance ID'),
  graphId: z.string().uuid().describe('Graph ID'),
  nodeId: z.string().describe('Node ID'),
  externalThreadId: z.string().describe('External thread ID (graphId:threadUUID)'),
  type: z.nativeEnum(RuntimeType).describe('Runtime type'),
  status: z
    .nativeEnum(RuntimeInstanceStatus)
    .describe('Runtime instance status'),
  containerName: z.string().describe('Container name'),
  lastUsedAt: z.iso.datetime().describe('Last used timestamp'),
  createdAt: z.iso.datetime().describe('Creation timestamp'),
  updatedAt: z.iso.datetime().describe('Last update timestamp'),
});

export class GetRuntimesQueryDto extends createZodDto(
  GetRuntimesQuerySchema,
) {}
export class RuntimeInstanceDto extends createZodDto(
  RuntimeInstanceSchema,
) {}
