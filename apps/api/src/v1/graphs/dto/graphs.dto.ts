import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { GraphSchema as RealGraphSchema, GraphStatus } from '../graphs.types';

export const GraphEditableSchemaField = RealGraphSchema.omit({
  metadata: true,
});

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
}).extend({
  metadata: GraphEditableSchemaField,
});

export class GraphDto extends createZodDto(GraphSchema) {}
export class CreateGraphDto extends createZodDto(GraphEditableSchema) {}
export class UpdateGraphDto extends createZodDto(
  GraphEditableSchema.partial(),
) {}
