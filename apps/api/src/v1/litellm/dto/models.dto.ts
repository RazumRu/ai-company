import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LiteLlmModelSchema = z.object({
  id: z.string().describe('Model identifier'),
  ownedBy: z.string().describe('Owner of the model'),
});

export class LiteLlmModelDto extends createZodDto(LiteLlmModelSchema) {}
