import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { NodeKind } from '../../graphs/graphs.types';

export const TemplateSchema = z.object({
  name: z.string(),
  description: z.string(),
  kind: z.enum(NodeKind),
  schema: z.record(z.string(), z.unknown()),
});

export class TemplateDto extends createZodDto(TemplateSchema) {}
