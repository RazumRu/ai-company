import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { GraphSchema as RealGraphSchema, GraphStatus } from '../graphs.types';

export const GraphSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  version: z.string(),
  schema: RealGraphSchema,
  status: z.enum(GraphStatus),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const GraphEditableSchema = GraphSchema.omit({
  id: true,
  status: true,
  error: true,
  createdAt: true,
  updatedAt: true,
});

export const ExecuteTriggerSchema = z.object({
  messages: z
    .array(z.string())
    .min(1)
    .describe('Array of messages to send to the trigger'),
});

// Tool call schema for AI messages
export const ToolCallSchema = z.object({
  name: z.string().describe('Tool name'),
  args: z.record(z.string(), z.unknown()).describe('Tool arguments'),
  type: z.string().describe('Tool call type'),
  id: z.string().describe('Tool call ID'),
});

// Human message schema
export const HumanMessageSchema = z.object({
  role: z.literal('human').describe('Message role'),
  content: z.string().describe('Message content'),
  additionalKwargs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional message metadata'),
});

// AI message schema
export const AIMessageSchema = z.object({
  role: z.literal('ai').describe('Message role'),
  content: z.string().describe('Message content'),
  id: z.string().optional().describe('Message ID'),
  toolCalls: z
    .array(ToolCallSchema)
    .optional()
    .describe('Tool calls in the message'),
  additionalKwargs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional message metadata'),
});

// System message schema
export const SystemMessageSchema = z.object({
  role: z.literal('system').describe('Message role'),
  content: z.string().describe('Message content'),
  additionalKwargs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional message metadata'),
});

// Shell tool result schema
export const ShellToolResultSchema = z.object({
  exitCode: z.number().describe('Exit code of the shell command'),
  stdout: z.string().describe('Standard output from the command'),
  stderr: z.string().describe('Standard error from the command'),
  cmd: z.string().describe('The command that was executed'),
  fail: z.boolean().optional().describe('Whether the command failed'),
});

// Shell tool message schema (specific for shell tool results)
export const ShellToolMessageSchema = z.object({
  role: z.literal('tool-shell').describe('Message role'),
  name: z.literal('shell').describe('Tool name - shell'),
  content: ShellToolResultSchema.describe('Parsed shell execution result'),
  toolCallId: z.string().describe('Tool call ID'),
  additionalKwargs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional message metadata'),
});

// Generic tool message schema (for other tools)
export const ToolMessageSchema = z.object({
  role: z.literal('tool').describe('Message role'),
  name: z.string().describe('Tool name'),
  content: z
    .record(z.string(), z.unknown())
    .describe('Parsed tool result as JSON'),
  toolCallId: z.string().describe('Tool call ID'),
  additionalKwargs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional message metadata'),
});

// Union type for all message types
export const MessageSchema = z.discriminatedUnion('role', [
  HumanMessageSchema,
  AIMessageSchema,
  SystemMessageSchema,
  ShellToolMessageSchema,
  ToolMessageSchema,
]);

export const GetGraphMessagesQuerySchema = z.object({
  threadId: z
    .string()
    .optional()
    .describe(
      'Thread ID to filter messages (if not provided, returns all threads)',
    ),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe('Maximum number of messages to return per thread'),
});

export const ThreadMessagesSchema = z.object({
  id: z.string().describe('Thread ID'),
  messages: z.array(MessageSchema).describe('Array of messages in this thread'),
  checkpointId: z.string().optional().describe('Checkpoint ID'),
});

export const GraphMessagesResponseSchema = z.object({
  nodeId: z.string().describe('Node ID'),
  threads: z
    .array(ThreadMessagesSchema)
    .describe('Array of threads with their messages'),
});

export class GraphDto extends createZodDto(GraphSchema) {}
export class CreateGraphDto extends createZodDto(GraphEditableSchema) {}
export class UpdateGraphDto extends createZodDto(
  GraphEditableSchema.partial(),
) {}
export class ExecuteTriggerDto extends createZodDto(ExecuteTriggerSchema) {}

// Export message types
export type ToolCallDto = z.infer<typeof ToolCallSchema>;
export type ShellToolResultDto = z.infer<typeof ShellToolResultSchema>;
export type HumanMessageDto = z.infer<typeof HumanMessageSchema>;
export type AIMessageDto = z.infer<typeof AIMessageSchema>;
export type SystemMessageDto = z.infer<typeof SystemMessageSchema>;
export type ShellToolMessageDto = z.infer<typeof ShellToolMessageSchema>;
export type ToolMessageDto = z.infer<typeof ToolMessageSchema>;
export type MessageDto =
  | HumanMessageDto
  | AIMessageDto
  | SystemMessageDto
  | ShellToolMessageDto
  | ToolMessageDto;

export class GetGraphMessagesQueryDto extends createZodDto(
  GetGraphMessagesQuerySchema,
) {}
export class ThreadMessagesDto extends createZodDto(ThreadMessagesSchema) {}
export class GraphMessagesResponseDto extends createZodDto(
  GraphMessagesResponseSchema,
) {}
