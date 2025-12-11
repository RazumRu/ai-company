import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ThreadAnalysisResponseSchema = z.object({
  analysis: z
    .string()
    .describe('LLM-generated analysis and improvement suggestions'),
  conversationId: z
    .string()
    .describe('Identifier of the LLM conversation used for the analysis'),
});

export const ThreadAnalysisRequestSchema = z.object({
  userInput: z
    .string()
    .min(1)
    .max(5000)
    .optional()
    .describe('Optional user-provided input to guide the analysis'),
  threadId: z
    .string()
    .optional()
    .describe(
      'Optional LLM conversation id to continue the existing suggestion thread',
    ),
});

export class ThreadAnalysisResponseDto extends createZodDto(
  ThreadAnalysisResponseSchema,
) {}

export class ThreadAnalysisRequestDto extends createZodDto(
  ThreadAnalysisRequestSchema,
) {}

export type ThreadAnalysisResponse = z.infer<
  typeof ThreadAnalysisResponseSchema
>;
export type ThreadAnalysisRequest = z.infer<typeof ThreadAnalysisRequestSchema>;
