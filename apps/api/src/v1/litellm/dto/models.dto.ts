import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LiteLlmModelSchema = z.object({
  id: z.string().describe('Model identifier'),
  ownedBy: z.string().describe('Owner of the model'),
  supportsEmbedding: z.boolean().describe('Whether this model supports embedding'),
});

export class LiteLlmModelDto extends createZodDto(LiteLlmModelSchema) {}

export const ModelDefaultsSchema = z.object({
  llmLargeModel: z.string(),
  llmLargeCodeModel: z.string(),
  llmMiniCodeModel: z.string(),
  llmCodeExplorerSubagentModel: z.string(),
  llmMiniModel: z.string(),
  llmEmbeddingModel: z.string(),
});

export class ModelDefaultsDto extends createZodDto(ModelDefaultsSchema) {}
