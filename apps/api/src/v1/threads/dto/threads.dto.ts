import { zodQueryArray } from '@packages/http-server';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { MessageSchema } from '../../graphs/dto/graphs.dto';
import { ThreadStatus } from '../threads.types';

const ThreadStatusesQuerySchema = zodQueryArray(z.enum(ThreadStatus));

export const TokenUsageSchema = z.object({
  inputTokens: z.number().describe('Input tokens'),
  cachedInputTokens: z.number().optional().describe('Cached input tokens'),
  outputTokens: z.number().describe('Output tokens'),
  reasoningTokens: z.number().optional().describe('Reasoning tokens'),
  totalTokens: z.number().describe('Total tokens'),
  totalPrice: z.number().optional().describe('Total price in USD'),
  currentContext: z
    .number()
    .optional()
    .describe('Current context size in tokens (snapshot, not additive)'),
});

export const ThreadTokenUsageSchema = TokenUsageSchema.extend({
  byNode: z
    .record(z.string(), TokenUsageSchema)
    .optional()
    .describe('Token usage breakdown by node ID'),
});

// Usage statistics schemas
export const UsageStatisticsByToolSchema = z.object({
  toolName: z.string().describe('Tool name'),
  totalTokens: z.number().describe('Total tokens used by this tool'),
  totalPrice: z
    .number()
    .optional()
    .describe('Total price for this tool in USD'),
  callCount: z.number().describe('Number of times this tool was called'),
});

export const UsageStatisticsAggregateSchema = TokenUsageSchema.extend({
  requestCount: z
    .number()
    .describe('Number of requests (messages with requestTokenUsage)'),
});

export const ThreadUsageStatisticsSchema = z.object({
  total: TokenUsageSchema.describe(
    'Total usage statistics for the entire thread',
  ),
  requests: z
    .number()
    .describe('Total number of requests (messages with requestTokenUsage)'),
  byNode: z
    .record(z.string(), TokenUsageSchema)
    .describe('Usage statistics breakdown by node ID'),
  byTool: z
    .array(UsageStatisticsByToolSchema)
    .describe('Usage statistics breakdown by tool name'),
  toolsAggregate: UsageStatisticsAggregateSchema.describe(
    'Aggregated statistics for all tool message requests',
  ),
  messagesAggregate: UsageStatisticsAggregateSchema.describe(
    'Aggregated statistics for all non-tool message requests (human, ai, system, reasoning)',
  ),
});

// Thread schema
export const ThreadSchema = z.object({
  id: z.uuid().describe('Thread ID'),
  graphId: z.uuid().describe('Graph ID'),
  externalThreadId: z.string().describe('External thread ID from LangChain'),
  lastRunId: z
    .uuid()
    .optional()
    .nullable()
    .describe('Last LangGraph run_id observed for this thread'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .nullable()
    .describe('Additional thread metadata'),
  source: z
    .string()
    .optional()
    .nullable()
    .describe('Source of thread creation (e.g., trigger template name)'),
  name: z
    .string()
    .optional()
    .nullable()
    .describe('Thread name (auto-generated from first user message)'),
  status: z.enum(ThreadStatus).describe('Thread execution status'),
});

export const ThreadMessageSchema = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  nodeId: z.string(),
  externalThreadId: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  message: MessageSchema,
  requestTokenUsage: TokenUsageSchema.optional()
    .nullable()
    .describe(
      'Full LLM request token usage & cost (entire request, not just this message)',
    ),
});

// Get threads query parameters
export const GetThreadsQuerySchema = z.object({
  graphId: z.uuid().describe('Filter by graph ID').optional(),
  statuses: ThreadStatusesQuerySchema.optional().describe(
    'Filter by thread statuses',
  ),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(50)
    .describe('Maximum number of threads to return'),
  offset: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe('Number of threads to skip'),
});

// Get messages query parameters
export const GetMessagesQuerySchema = z.object({
  nodeId: z
    .string()
    .optional()
    .describe('Filter messages by node ID (agent node)'),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .default(100)
    .describe('Maximum number of messages to return'),
  offset: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe('Number of messages to skip'),
});

// Set thread metadata
export const SetThreadMetadataSchema = z.object({
  metadata: z
    .record(z.string(), z.unknown())
    .describe('Thread metadata to set (replaces existing metadata)'),
});

// Type exports
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type ThreadTokenUsage = z.infer<typeof ThreadTokenUsageSchema>;
export type UsageStatisticsByTool = z.infer<typeof UsageStatisticsByToolSchema>;
export type UsageStatisticsAggregate = z.infer<
  typeof UsageStatisticsAggregateSchema
>;
export type ThreadUsageStatistics = z.infer<typeof ThreadUsageStatisticsSchema>;

// DTOs
export class ThreadDto extends createZodDto(ThreadSchema) {}
export class ThreadMessageDto extends createZodDto(ThreadMessageSchema) {}
export class GetThreadsQueryDto extends createZodDto(GetThreadsQuerySchema) {}
export class GetMessagesQueryDto extends createZodDto(GetMessagesQuerySchema) {}
export class ThreadUsageStatisticsDto extends createZodDto(
  ThreadUsageStatisticsSchema,
) {}
export class SetThreadMetadataDto extends createZodDto(
  SetThreadMetadataSchema,
) {}
