import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { NodeKind } from '../../graphs/graphs.types';

const NodeConnectionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('kind'),
    value: z.enum(NodeKind),
    required: z.boolean().optional(),
    multiple: z.boolean(),
  }),
  z.object({
    type: z.literal('template'),
    value: z.string(),
    required: z.boolean().optional(),
    multiple: z.boolean(),
  }),
]);

export const TemplateSchema = z.object({
  name: z.string(),
  description: z.string(),
  kind: z.enum(NodeKind),
  schema: z.record(z.string(), z.unknown()),
  inputs: z.array(NodeConnectionSchema).optional(),
  outputs: z.array(NodeConnectionSchema).optional(),
});

export class TemplateDto extends createZodDto(TemplateSchema) {}
