import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LiteLlmModelSchema = z.object({
  id: z.string().describe('Model identifier'),
  ownedBy: z.string().describe('Owner of the model'),
  supportsEmbedding: z
    .boolean()
    .describe('Whether this model supports embedding'),
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

// Admin model info (returned by GET /litellm/models/info)
export const LiteLlmModelInfoItemSchema = z.object({
  id: z.string().describe('LiteLLM database model ID'),
  modelName: z.string().describe('Model alias (display name)'),
  providerModel: z.string().describe('Underlying provider model identifier'),
  apiBase: z.string().optional().describe('Custom API base URL'),
  customLlmProvider: z.string().optional().describe('Provider override'),
  supportsToolCalling: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
});
export class LiteLlmModelInfoItemDto extends createZodDto(
  LiteLlmModelInfoItemSchema,
) {}

// Create model
export const LiteLlmParamsSchema = z.object({
  model: z.string().describe('Provider model ID, e.g. openai/gpt-4o'),
  apiKey: z.string().optional().describe('Provider API key'),
  apiBase: z.string().optional().describe('Custom API base URL'),
  customLlmProvider: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  requestTimeout: z.number().int().positive().optional(),
  customHeaders: z.record(z.string(), z.string()).optional(),
  litellmCredentialName: z
    .string()
    .optional()
    .describe('Named credential reference'),
});

export const CreateLiteLlmModelSchema = z.object({
  modelName: z.string().min(1).describe('Display name / alias'),
  litellmParams: LiteLlmParamsSchema,
  tags: z.array(z.string()).optional().describe('Routing tags for this model'),
  modelInfo: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional model info metadata'),
});
export class CreateLiteLlmModelDto extends createZodDto(
  CreateLiteLlmModelSchema,
) {}

// Update model
export const UpdateLiteLlmModelSchema = z.object({
  modelId: z.string().describe('LiteLLM database model ID from model_info.id'),
  modelName: z.string().min(1).optional(),
  litellmParams: LiteLlmParamsSchema.partial().optional(),
  tags: z.array(z.string()).optional().describe('Routing tags for this model'),
  modelInfo: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional model info metadata'),
});
export class UpdateLiteLlmModelDto extends createZodDto(
  UpdateLiteLlmModelSchema,
) {}

// Test model response
export const TestModelResponseSchema = z.object({
  success: z.boolean(),
  latencyMs: z.number(),
  error: z.string().optional(),
});
export class TestModelResponseDto extends createZodDto(
  TestModelResponseSchema,
) {}

// Test model request
export const TestModelRequestSchema = z.object({
  model: z.string().min(1).describe('Model alias to test'),
});
export class TestModelRequestDto extends createZodDto(TestModelRequestSchema) {}

// Test model connection with inline config (no prior registration needed)
export const TestModelConnectionSchema = z.object({
  litellmModel: z
    .string()
    .min(1)
    .describe('LiteLLM model string, e.g. openai/gpt-4o'),
  apiKey: z.string().optional().describe('Provider API key'),
  apiBase: z.string().optional().describe('Custom API base URL'),
  litellmCredentialName: z
    .string()
    .optional()
    .describe('Named credential reference (resolved server-side)'),
});
export class TestModelConnectionDto extends createZodDto(
  TestModelConnectionSchema,
) {}

// Provider list
export const LiteLlmProviderSchema = z.object({
  name: z.string().describe('Provider identifier, e.g. openai, anthropic'),
  label: z.string().describe('Human-readable label'),
  modelHint: z.string().describe('Example model name format'),
});
export class LiteLlmProviderDto extends createZodDto(LiteLlmProviderSchema) {}

export const LiteLlmProvidersResponseSchema = z.object({
  providers: z.array(LiteLlmProviderSchema),
});
export class LiteLlmProvidersResponseDto extends createZodDto(
  LiteLlmProvidersResponseSchema,
) {}

// Credentials
export const LiteLlmCredentialSchema = z.object({
  credentialName: z.string().describe('Unique credential identifier'),
});
export class LiteLlmCredentialDto extends createZodDto(
  LiteLlmCredentialSchema,
) {}

export const LiteLlmCredentialsResponseSchema = z.object({
  credentials: z.array(LiteLlmCredentialSchema),
});
export class LiteLlmCredentialsResponseDto extends createZodDto(
  LiteLlmCredentialsResponseSchema,
) {}

export const CreateLiteLlmCredentialSchema = z.object({
  credentialName: z.string().min(1).describe('Unique credential identifier'),
  credentialValues: z
    .record(z.string(), z.string())
    .describe('Key-value pairs, e.g. { api_key: "sk-..." }'),
});
export class CreateLiteLlmCredentialDto extends createZodDto(
  CreateLiteLlmCredentialSchema,
) {}
