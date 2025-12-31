import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { MessageSchema } from '../../graphs/dto/graphs.dto';
import { ThreadStatus } from '../threads.types';

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

export const MessageTokenUsageSchema = z.object({
  totalTokens: z.number().describe('Total tokens for this message'),
  totalPrice: z
    .number()
    .optional()
    .describe('Total price for this message in USD'),
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
  tokenUsage: ThreadTokenUsageSchema.optional()
    .nullable()
    .describe('Aggregated token usage & cost for this thread'),
});

export const ThreadMessageSchema = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  nodeId: z.string(),
  externalThreadId: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  message: MessageSchema,
  tokenUsage: MessageTokenUsageSchema.optional()
    .nullable()
    .describe('Token usage & cost for this message'),
});

// Get threads query parameters
export const GetThreadsQuerySchema = z.object({
  graphId: z.uuid().describe('Filter by graph ID').optional(),
  statuses: z
    .array(z.enum(ThreadStatus))
    .optional()
    .describe('Filter by thread statuses'),
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

// Type exports
export type ThreadTokenUsage = z.infer<typeof ThreadTokenUsageSchema>;
export type MessageTokenUsage = z.infer<typeof MessageTokenUsageSchema>;

// DTOs
export class ThreadDto extends createZodDto(ThreadSchema) {}
export class ThreadMessageDto extends createZodDto(ThreadMessageSchema) {}
export class GetThreadsQueryDto extends createZodDto(GetThreadsQuerySchema) {}
export class GetMessagesQueryDto extends createZodDto(GetMessagesQuerySchema) {}
