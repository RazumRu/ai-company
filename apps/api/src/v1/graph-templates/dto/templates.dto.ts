import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { NodeKind } from '../../graphs/graphs.types';

const AllowedTemplateSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('kind'),
    value: z.enum(NodeKind),
    required: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('template'),
    value: z.string(),
    required: z.boolean().optional(),
  }),
]);

export const TemplateSchema = z.object({
  name: z.string(),
  description: z.string(),
  kind: z.enum(NodeKind),
  schema: z.record(z.string(), z.unknown()),
  allowedTemplates: z.array(AllowedTemplateSchema).optional(),
});

export class TemplateDto extends createZodDto(TemplateSchema) {}
