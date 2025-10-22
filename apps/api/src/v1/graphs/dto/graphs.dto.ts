import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { GraphSchema as RealGraphSchema, GraphStatus } from '../graphs.types';

// Node coordinates schema for UI positioning
export const NodeMetadataSchema = z.object({
  id: z.string(),
  x: z.number().describe('X coordinate of the node'),
  y: z.number().describe('Y coordinate of the node'),
  name: z.string().optional().describe('Optional display name for the node'),
});

// Graph metadata with node coordinates
export const GraphMetadataSchema = z
  .object({
    nodes: z
      .array(NodeMetadataSchema)
      .optional()
      .describe('Node coordinates and names by node ID'),
    zoom: z.number().optional().describe('Zoom level for graph display'),
    x: z.number().optional().describe('X coordinate'),
    y: z.number().optional().describe('Y coordinate'),
  })
  .loose();

export const GraphSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  version: z.string(),
  schema: RealGraphSchema,
  status: z.enum(GraphStatus),
  metadata: GraphMetadataSchema.optional().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  temporary: z
    .boolean()
    .default(false)
    .optional()
    .nullable()
    .describe(
      'If true, graph will be deleted instead of restored after server restart',
    ),
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
  threadSubId: z
    .string()
    .optional()
    .describe(
      'Optional thread sub-ID that will be used to create the full thread ID.',
    ),
});

export const ExecuteTriggerResponseSchema = z.object({
  threadId: z.string().describe('The thread ID used for this execution'),
  checkpointNs: z
    .string()
    .optional()
    .describe('The checkpoint namespace for this execution'),
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
    .describe('Full thread ID (e.g., "graphId:threadComponent")'),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe('Maximum number of messages to return'),
});

export const ThreadMessagesSchema = z.object({
  id: z.string().describe('Thread ID'),
  messages: z.array(MessageSchema).describe('Array of messages in this thread'),
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
export class ExecuteTriggerResponseDto extends createZodDto(
  ExecuteTriggerResponseSchema,
) {}

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
