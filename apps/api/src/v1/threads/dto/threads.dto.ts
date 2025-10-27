import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { MessageSchema } from '../../graphs/dto/graphs.dto';

// Thread schema
export const ThreadSchema = z.object({
  id: z.uuid().describe('Thread ID'),
  graphId: z.uuid().describe('Graph ID'),
  externalThreadId: z.string().describe('External thread ID from LangChain'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .nullable()
    .describe('Additional thread metadata'),
});

export const ThreadMessageSchema = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  nodeId: z.string(),
  externalThreadId: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  message: MessageSchema,
});

// Get threads query parameters
export const GetThreadsQuerySchema = z.object({
  graphId: z.uuid().describe('Filter by graph ID'),
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

// DTOs
export class ThreadDto extends createZodDto(ThreadSchema) {}
export class ThreadMessageDto extends createZodDto(ThreadMessageSchema) {}
export class GetThreadsQueryDto extends createZodDto(GetThreadsQuerySchema) {}
export class GetMessagesQueryDto extends createZodDto(GetMessagesQuerySchema) {}
