import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const InstructionBlockResponseSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  contentHash: z.string(),
});

export class InstructionBlockResponseDto extends createZodDto(
  InstructionBlockResponseSchema,
) {}
