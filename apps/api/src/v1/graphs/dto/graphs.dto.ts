import { zodQueryArray } from '@packages/http-server';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { CostLimitSettingsSchema } from '../../cost-limits/cost-limit-settings.schema';
import {
  GraphNodeStatus,
  GraphSchema as RealGraphSchema,
  GraphStatus,
  MessageRole,
  NodeKind,
} from '../graphs.types';
import { GraphRevisionSchema } from './graph-revisions.dto';

// Node coordinates schema for UI positioning
export const NodeMetadataSchema = z.object({
  id: z.string(),
  x: z.number().optional().describe('X coordinate of the node'),
  y: z.number().optional().describe('Y coordinate of the node'),
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
  targetVersion: z
    .string()
    .describe('Target version after all queued revisions are applied'),
  schema: RealGraphSchema,
  status: z.enum(GraphStatus),
  metadata: GraphMetadataSchema.optional().nullable(),
  runningThreads: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Number of threads currently in running state'),
  totalThreads: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Total number of threads for this graph'),
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
  projectId: z
    .uuid()
    .nullable()
    .optional()
    .describe('Project this graph belongs to'),
  settings: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Arbitrary per-graph settings stored as JSONB'),
  costLimitUsd: CostLimitSettingsSchema.shape.costLimitUsd.describe(
    'Optional cost limit in USD projected from settings.costLimitUsd',
  ),
});

export const TriggerNodeInfoSchema = z.object({
  id: z.string().describe('Node ID'),
  name: z.string().describe('Display name (from metadata or template name)'),
  template: z.string().describe('Template identifier'),
});

export const GraphPreviewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  version: z.string(),
  targetVersion: z
    .string()
    .describe('Target version after all queued revisions are applied'),
  status: z.enum(GraphStatus),
  runningThreads: z.number().int().nonnegative().default(0),
  totalThreads: z.number().int().nonnegative().default(0),
  nodeCount: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Number of nodes in the graph schema'),
  edgeCount: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Number of edges in the graph schema'),
  agents: z
    .array(
      z.object({
        nodeId: z.string(),
        name: z.string(),
        description: z.string().optional(),
      }),
    )
    .default([])
    .describe('Agent nodes present in the graph'),
  triggerNodes: z
    .array(TriggerNodeInfoSchema)
    .describe('Pre-computed trigger nodes from schema'),
  nodeDisplayNames: z
    .record(z.string(), z.string())
    .describe('Pre-computed node display names from metadata'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  temporary: z.boolean().default(false).optional().nullable(),
  projectId: z.uuid().nullable().optional(),
  costLimitUsd: CostLimitSettingsSchema.shape.costLimitUsd.describe(
    'Optional cost limit in USD projected from settings.costLimitUsd',
  ),
});

export const GetGraphsPreviewQuerySchema = z.object({
  ids: zodQueryArray(z.uuid())
    .optional()
    .describe('Filter graphs by IDs (comma-separated or repeated params)'),
});

export class GraphPreviewDto extends createZodDto(GraphPreviewSchema) {}
export class GetGraphsPreviewQueryDto extends createZodDto(
  GetGraphsPreviewQuerySchema,
) {}
export type TriggerNodeInfoType = z.infer<typeof TriggerNodeInfoSchema>;

export const GraphEditableSchema = GraphSchema.omit({
  id: true,
  status: true,
  error: true,
  runningThreads: true,
  totalThreads: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  targetVersion: true,
  projectId: true,
});

/**
 * Matches invisible unicode characters that should be stripped from user input.
 * Uses \p{Default_Ignorable_Code_Point} (covers zero-width chars, tag chars,
 * variation selectors, BOM, etc.) with set subtraction to preserve BiDi marks,
 * soft hyphens, and Hangul fillers that have legitimate text uses.
 */
const INVISIBLE_RE =
  /[\p{Default_Ignorable_Code_Point}--[\u00AD\u200E\u200F\u202A-\u202E\u2066-\u2069\u115F\u1160\u3164\uFFA0]]/gv;
const stripInvisibleUnicode = (text: string): string =>
  text.replace(INVISIBLE_RE, '');

// Content block schemas for multimodal messages
export const TextContentBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1).describe('Text content'),
});

export const ImageUrlContentBlockSchema = z.object({
  type: z.literal('image_url'),
  image_url: z.object({
    url: z
      .string()
      .refine(
        (url) => /^data:image\/(png|jpeg|gif|webp);base64,/.test(url),
        'Image URL must be a valid base64 data URL (png, jpeg, gif, or webp)',
      )
      .refine((url) => {
        const base64 = url.split(',')[1];
        if (!base64) {
          return false;
        }
        const sizeBytes = Math.ceil((base64.length * 3) / 4);
        return sizeBytes <= 5 * 1024 * 1024;
      }, 'Image must be 5 MB or smaller')
      .describe('Base64 data URL (data:image/...;base64,...)'),
    detail: z
      .enum(['auto', 'low', 'high'])
      .optional()
      .default('auto')
      .describe('Vision detail level'),
  }),
});

export const ContentBlockSchema = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  ImageUrlContentBlockSchema,
]);

export type ContentBlockData = z.infer<typeof ContentBlockSchema>;

export const ExecuteTriggerSchema = z.object({
  messages: z
    .array(
      z.union([
        z.string().transform(stripInvisibleUnicode),
        z.object({
          content: z
            .array(ContentBlockSchema)
            .min(1)
            .refine(
              (blocks) => blocks.some((b) => b.type === 'text'),
              'At least one text content block is required',
            )
            .refine(
              (blocks) =>
                blocks.filter((b) => b.type === 'image_url').length <= 5,
              'Maximum 5 images per message',
            )
            .describe('Content blocks for multimodal messages'),
        }),
      ]),
    )
    .min(1)
    .describe(
      'Array of messages — plain strings or structured objects with content blocks',
    ),
  threadSubId: z
    .string()
    .optional()
    .describe(
      'Optional thread sub-ID that will be used to create the full thread ID.',
    ),
  async: z
    .boolean()
    .optional()
    .describe(
      'If true, do not wait for execution to finish (fire-and-forget).',
    ),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Optional metadata to attach to the thread created by this execution.',
    ),
});

export const ExecuteTriggerResponseSchema = z.object({
  externalThreadId: z
    .string()
    .describe('The thread ID used for this execution'),
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
  title: z
    .string()
    .optional()
    .describe('Optional human-readable tool call title'),
});

// Human message schema
export const HumanMessageSchema = z.object({
  role: z.literal(MessageRole.Human).describe('Message role'),
  content: z
    .union([z.string(), z.array(ContentBlockSchema).min(1)])
    .describe('Message content — plain string or array of content blocks'),
  runId: z
    .string()
    .optional()
    .nullable()
    .describe('Run ID associated with this message'),
  additionalKwargs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional message metadata'),
});

// AI message schema
export const AIMessageSchema = z.object({
  role: z.literal(MessageRole.AI).describe('Message role'),
  content: z.string().describe('Message content'),
  id: z.string().optional().describe('Message ID'),
  runId: z
    .string()
    .optional()
    .nullable()
    .describe('Run ID associated with this message'),
  toolCalls: z
    .array(ToolCallSchema)
    .optional()
    .describe('Tool calls in the message'),
  additionalKwargs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional message metadata'),
});

// Reasoning message schema
export const ReasoningMessageSchema = z.object({
  id: z.string().optional().describe('Message ID'),
  role: z.literal(MessageRole.Reasoning).describe('Message role'),
  content: z.string().describe('Reasoning trace emitted by the model'),
  runId: z
    .string()
    .optional()
    .nullable()
    .describe('Run ID associated with this message'),
  additionalKwargs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional message metadata'),
});

// System message schema
export const SystemMessageSchema = z.object({
  role: z.literal(MessageRole.System).describe('Message role'),
  content: z.string().describe('Message content'),
  runId: z
    .string()
    .optional()
    .nullable()
    .describe('Run ID associated with this message'),
  additionalKwargs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional message metadata'),
});

// Generic tool message schema (for other tools)
export const ToolMessageSchema = z.object({
  role: z.literal(MessageRole.Tool).describe('Message role'),
  name: z.string().describe('Tool name'),
  content: z
    .record(z.string(), z.unknown())
    .describe('Parsed tool result as JSON'),
  toolCallId: z.string().describe('Tool call ID'),
  runId: z
    .string()
    .optional()
    .nullable()
    .describe('Run ID associated with this message'),
  title: z
    .string()
    .optional()
    .describe('Optional human-readable tool call title'),
  additionalKwargs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional message metadata'),
});

// Union type for all message types
export const MessageSchema = z.discriminatedUnion('role', [
  HumanMessageSchema,
  AIMessageSchema,
  ReasoningMessageSchema,
  SystemMessageSchema,
  ToolMessageSchema,
]);

export const ThreadMessagesSchema = z.object({
  id: z.string().describe('Thread ID'),
  messages: z.array(MessageSchema).describe('Array of messages in this thread'),
});

export const GetAllGraphsQuerySchema = z.object({
  ids: zodQueryArray(z.uuid())
    .optional()
    .describe('Filter graphs by IDs (comma-separated or repeated params)'),
});

export const GraphNodesQuerySchema = z.object({
  threadId: z.string().optional(),
  runId: z.string().optional(),
});

export const GraphNodeWithStatusSchema = z.object({
  id: z.string().describe('Node ID'),
  name: z.string().describe('Display name for node'),
  template: z.string().describe('Template identifier'),
  type: z.enum(NodeKind).describe('Node kind'),
  status: z.enum(GraphNodeStatus).describe('Current node status'),
  config: z.unknown().describe('Node configuration'),
  error: z.string().nullable().optional().describe('Last error message'),
  metadata: z
    .object({
      threadId: z.string().optional(),
      runId: z.string().optional(),
      parentThreadId: z.string().optional(),
    })
    .optional(),
  additionalNodeMetadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional metadata exposed by the node implementation'),
});

export class GraphDto extends createZodDto(GraphSchema) {}
export class CreateGraphDto extends createZodDto(GraphEditableSchema) {}
export class GetAllGraphsQueryDto extends createZodDto(
  GetAllGraphsQuerySchema,
) {}
const UpdateGraphSchema = GraphEditableSchema.partial()
  .extend({
    currentVersion: z
      .string()
      .describe(
        'Current version of the graph (for optimistic locking and 3-way merge base)',
      ),
  })
  .strict();

export class UpdateGraphDto extends createZodDto(UpdateGraphSchema) {}

// Response schema for update operation
export const UpdateGraphResponseSchema = z.object({
  graph: GraphSchema.describe('Updated graph'),
  revision: GraphRevisionSchema.optional()
    .nullable()
    .describe(
      'Created revision if update required applying non-metadata changes',
    ),
});

export class UpdateGraphResponseDto extends createZodDto(
  UpdateGraphResponseSchema,
) {}
export class ExecuteTriggerDto extends createZodDto(ExecuteTriggerSchema) {}
export class ExecuteTriggerResponseDto extends createZodDto(
  ExecuteTriggerResponseSchema,
) {}
export class GraphNodesQueryDto extends createZodDto(GraphNodesQuerySchema) {}
export class GraphNodeWithStatusDto extends createZodDto(
  GraphNodeWithStatusSchema,
) {}

// Export message types
export type HumanMessageDto = z.infer<typeof HumanMessageSchema>;
export type AIMessageDto = z.infer<typeof AIMessageSchema>;
export type ReasoningMessageDto = z.infer<typeof ReasoningMessageSchema>;
export type SystemMessageDto = z.infer<typeof SystemMessageSchema>;
export type ToolMessageDto = z.infer<typeof ToolMessageSchema>;
export type MessageDto =
  | HumanMessageDto
  | AIMessageDto
  | ReasoningMessageDto
  | SystemMessageDto
  | ToolMessageDto;
