import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SystemAgentResponseSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  name: z.string(),
  description: z.string(),
  tools: z.array(z.string()),
  defaultModel: z.string().nullable(),
  instructions: z.string(),
  contentHash: z.string(),
});

export class SystemAgentResponseDto extends createZodDto(
  SystemAgentResponseSchema,
) {}
