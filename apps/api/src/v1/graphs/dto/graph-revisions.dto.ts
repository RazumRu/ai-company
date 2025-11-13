import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  GraphRevisionStatus,
  GraphSchema as RealGraphSchema,
} from '../graphs.types';

const JsonPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    path: z.string(),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal('remove'),
    path: z.string(),
  }),
  z.object({
    op: z.literal('replace'),
    path: z.string(),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal('move'),
    from: z.string(),
    path: z.string(),
  }),
  z.object({
    op: z.literal('copy'),
    from: z.string(),
    path: z.string(),
  }),
  z.object({
    op: z.literal('test'),
    path: z.string(),
    value: z.unknown(),
  }),
]);

export const ConfigurationDiffSchema = z
  .array(JsonPatchOperationSchema)
  .describe('JSON Patch (RFC 6902) operations between old and new schemas');

export const GraphRevisionSchema = z.object({
  id: z.uuid(),
  graphId: z.uuid(),
  baseVersion: z.string().describe('Version the client changes were based on'),
  toVersion: z.string().describe('New head version after this revision'),
  configurationDiff: ConfigurationDiffSchema,
  clientSchema: RealGraphSchema.describe('Schema submitted by the client'),
  newSchema: RealGraphSchema.describe('Merged schema result'),
  status: z.enum(GraphRevisionStatus),
  error: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const GraphRevisionQuerySchema = z.object({
  status: z.enum(GraphRevisionStatus).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Maximum number of revisions to return'),
});

export class GraphRevisionDto extends createZodDto(GraphRevisionSchema) {}
export class GraphRevisionQueryDto extends createZodDto(
  GraphRevisionQuerySchema,
) {}
