import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SuggestKnowledgeContentSchema = z.object({
  userRequest: z
    .string()
    .min(1)
    .describe('User request describing the knowledge content to generate'),
  threadId: z
    .string()
    .optional()
    .describe(
      'Optional thread id to continue a previous knowledge suggestion conversation',
    ),
});

export const SuggestKnowledgeContentResponseSchema = z.object({
  content: z.string().describe('Generated knowledge content'),
  threadId: z.string().describe('Thread id used for this suggestion session'),
});

export class SuggestKnowledgeContentDto extends createZodDto(
  SuggestKnowledgeContentSchema,
) {}

export class SuggestKnowledgeContentResponseDto extends createZodDto(
  SuggestKnowledgeContentResponseSchema,
) {}

export type SuggestKnowledgeContentRequest = z.infer<
  typeof SuggestKnowledgeContentSchema
>;
export type SuggestKnowledgeContentResponse = z.infer<
  typeof SuggestKnowledgeContentResponseSchema
>;
