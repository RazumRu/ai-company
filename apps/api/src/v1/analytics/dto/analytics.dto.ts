import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ── Query schemas ──────────────────────────────────────────────

export const AnalyticsQuerySchema = z.object({
  dateFrom: z
    .string()
    .datetime()
    .optional()
    .describe('Include threads created on or after this ISO 8601 datetime'),
  dateTo: z
    .string()
    .datetime()
    .optional()
    .describe('Include threads created before this ISO 8601 datetime'),
});

export const AnalyticsByGraphQuerySchema = AnalyticsQuerySchema.extend({
  graphId: z.string().uuid().optional().describe('Filter to a specific graph'),
});

export class AnalyticsQueryDto extends createZodDto(AnalyticsQuerySchema) {}
export class AnalyticsByGraphQueryDto extends createZodDto(
  AnalyticsByGraphQuerySchema,
) {}

// ── Response schemas ───────────────────────────────────────────

export const TokenAggregateSchema = z.object({
  totalThreads: z.number().int().describe('Total number of threads'),
  inputTokens: z.number().describe('Sum of input tokens'),
  cachedInputTokens: z.number().describe('Sum of cached input tokens'),
  outputTokens: z.number().describe('Sum of output tokens'),
  reasoningTokens: z.number().describe('Sum of reasoning tokens'),
  totalTokens: z.number().describe('Sum of all tokens'),
  totalPrice: z.number().describe('Total cost in USD'),
});

export const AnalyticsOverviewSchema = TokenAggregateSchema;

export const AnalyticsGraphEntrySchema = TokenAggregateSchema.extend({
  graphId: z.string().uuid().describe('Graph ID'),
  graphName: z.string().describe('Graph name'),
});

export const AnalyticsByGraphResponseSchema = z.object({
  graphs: z.array(AnalyticsGraphEntrySchema),
});

export class AnalyticsOverviewDto extends createZodDto(
  AnalyticsOverviewSchema,
) {}
export class AnalyticsByGraphResponseDto extends createZodDto(
  AnalyticsByGraphResponseSchema,
) {}

// ── Internal raw row types (from SQL) ──────────────────────────

export type TokenAggregateRawRow = {
  totalThreads: string;
  inputTokens: string;
  cachedInputTokens: string;
  outputTokens: string;
  reasoningTokens: string;
  totalTokens: string;
  totalPrice: string;
};

export type ByGraphRawRow = TokenAggregateRawRow & {
  graphId: string;
  graphName: string;
};
