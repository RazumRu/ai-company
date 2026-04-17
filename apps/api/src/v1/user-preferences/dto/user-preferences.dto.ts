import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const ModelOverridesSchema = z.object({
  llmLargeModel: z.string().max(200).nullable().optional(),
  llmLargeCodeModel: z.string().max(200).nullable().optional(),
  llmMiniCodeModel: z.string().max(200).nullable().optional(),
  llmCodeExplorerSubagentModel: z.string().max(200).nullable().optional(),
  llmMiniModel: z.string().max(200).nullable().optional(),
  llmEmbeddingModel: z.string().max(200).nullable().optional(),
});

const costLimitUsdSchema = z.number().min(0).nullable().optional();

export const UpdateUserPreferencesSchema = z.object({
  models: ModelOverridesSchema.optional(),
  costLimitUsd: costLimitUsdSchema,
});

export const UserPreferencesSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  preferences: z.object({
    models: ModelOverridesSchema.optional(),
    costLimitUsd: costLimitUsdSchema,
  }),
  costLimitUsd: costLimitUsdSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class UpdateUserPreferencesDto extends createZodDto(
  UpdateUserPreferencesSchema,
) {}
export class UserPreferencesDto extends createZodDto(UserPreferencesSchema) {}
