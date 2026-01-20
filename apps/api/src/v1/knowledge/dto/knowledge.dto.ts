import { zodQueryArray } from '@packages/http-server';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const KnowledgeDocSchema = z.object({
  id: z.uuid(),
  content: z.string(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const KnowledgeChunkSchema = z.object({
  id: z.uuid(),
  docId: z.uuid(),
  chunkIndex: z.number().int(),
  label: z.string().nullable().optional(),
  keywords: z.array(z.string()).nullable().optional(),
  text: z.string(),
  startOffset: z.number().int(),
  endOffset: z.number().int(),
  createdAt: z.iso.datetime(),
});

export const KnowledgeDocInputSchema = z.object({
  content: z.string().min(1).describe('Raw knowledge document content'),
});

export const KnowledgeDocListQuerySchema = z.object({
  tags: zodQueryArray(z.string().min(1))
    .optional()
    .describe('Filter by tags (match any)'),
  search: z.string().optional().describe('Search in title/summary/content'),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export class KnowledgeDocDto extends createZodDto(KnowledgeDocSchema) {}
export class KnowledgeChunkDto extends createZodDto(KnowledgeChunkSchema) {}
export class KnowledgeDocInputDto extends createZodDto(
  KnowledgeDocInputSchema,
) {}
export class KnowledgeDocListQueryDto extends createZodDto(
  KnowledgeDocListQuerySchema,
) {}

export type KnowledgeDocInput = z.infer<typeof KnowledgeDocInputSchema>;
export type KnowledgeDocListQuery = z.infer<typeof KnowledgeDocListQuerySchema>;
