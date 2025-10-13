import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { GraphSchema as RealGraphSchema, GraphStatus } from '../graphs.types';

export const GraphSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  version: z.string(),
  schema: RealGraphSchema,
  status: z.enum(GraphStatus),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const GraphEditableSchema = GraphSchema.omit({
  id: true,
  status: true,
  error: true,
  createdAt: true,
  updatedAt: true,
});

export const ExecuteTriggerSchema = z.object({
  messages: z
    .array(z.string())
    .min(1)
    .describe('Array of messages to send to the trigger'),
});

export class GraphDto extends createZodDto(GraphSchema) {}
export class CreateGraphDto extends createZodDto(GraphEditableSchema) {}
export class UpdateGraphDto extends createZodDto(
  GraphEditableSchema.partial(),
) {}
export class ExecuteTriggerDto extends createZodDto(ExecuteTriggerSchema) {}
