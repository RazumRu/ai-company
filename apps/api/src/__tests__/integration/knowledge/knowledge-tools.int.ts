import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { KnowledgeGetChunksTool } from '../../../v1/agent-tools/tools/common/knowledge/knowledge-get-chunks.tool';
import { KnowledgeSearchTool } from '../../../v1/agent-tools/tools/common/knowledge/knowledge-search.tool';
import { KnowledgeChunkDao } from '../../../v1/knowledge/dao/knowledge-chunk.dao';
import { KnowledgeDocDao } from '../../../v1/knowledge/dao/knowledge-doc.dao';
import { KnowledgeService } from '../../../v1/knowledge/services/knowledge.service';
import { createTestModule, TEST_USER_ID } from '../setup';

describe('Knowledge tools (integration)', () => {
  let app: INestApplication;
  let knowledgeService: KnowledgeService;
  let searchTool: KnowledgeSearchTool;
  let getChunksTool: KnowledgeGetChunksTool;
  let docDao: KnowledgeDocDao;
  let chunkDao: KnowledgeChunkDao;
  const createdDocIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    knowledgeService = app.get(KnowledgeService);
    searchTool = await app.resolve(KnowledgeSearchTool);
    getChunksTool = await app.resolve(KnowledgeGetChunksTool);
    docDao = app.get(KnowledgeDocDao);
    chunkDao = app.get(KnowledgeChunkDao);
    const dataSource = app.get(DataSource);
    await dataSource.synchronize();
  }, 120_000);

  afterEach(async () => {
    for (const id of createdDocIds) {
      await chunkDao.hardDelete({ docId: id });
      await docDao.deleteById(id);
    }
    createdDocIds.length = 0;
  });

  afterAll(async () => {
    await app?.close();
  });

  it(
    'searches knowledge with tag filters and retrieves chunks',
    { timeout: 30000 },
    async () => {
      const alphaContent = 'Alpha document content';
      const alphaDoc = await knowledgeService.createDoc({
        content: alphaContent,
      });
      createdDocIds.push(alphaDoc.id);
      expect(alphaDoc.tags.length).toBeGreaterThan(0);

      const searchResult = await searchTool.invoke(
        { query: 'Alpha', topK: 5 },
        { tags: alphaDoc.tags.slice(0, 1) },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: TEST_USER_ID,
          },
        },
      );

      const output = searchResult.output as {
        documentTitle: string;
        documentId: string;
        tags: string[];
        chunks: { chunkId: string; text: string; score: number }[];
      }[];
      expect(output.length).toBeGreaterThan(0);
      expect(output.length).toBeLessThanOrEqual(5);
      expect(output.some((entry) => entry.documentId === alphaDoc.id)).toBe(
        true,
      );
      output.forEach((entry) => {
        expect(entry.documentTitle.length).toBeGreaterThan(0);
        expect(entry.tags).toEqual(
          expect.arrayContaining([alphaDoc.tags[0] as string]),
        );
        expect(entry.chunks.length).toBeGreaterThan(0);
        entry.chunks.forEach((chunk) => {
          expect(chunk.score).toBeGreaterThanOrEqual(-1);
          expect(chunk.score).toBeLessThanOrEqual(1);
          expect(chunk.text.length).toBeGreaterThan(0);
        });
      });

      const alphaEntry = output.find(
        (entry) => entry.documentId === alphaDoc.id,
      );
      expect(alphaEntry).toBeDefined();
      const alphaChunk = alphaEntry!.chunks[0];
      expect(alphaChunk).toBeDefined();

      const chunkResult = await getChunksTool.invoke(
        { docId: alphaDoc.id, chunkIds: [alphaChunk!.chunkId] },
        { tags: alphaDoc.tags.slice(0, 1) },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: TEST_USER_ID,
          },
        },
      );

      const chunks = chunkResult.output as {
        id: string;
        docId: string;
        text: string;
        startOffset: number;
        endOffset: number;
      }[];
      expect(chunks.length).toBe(1);
      const chunk = chunks[0];
      expect(chunk).toBeDefined();
      expect(chunk?.id).toBe(alphaChunk?.chunkId);
      expect(chunk?.docId).toBe(alphaDoc.id);
      const doc = await knowledgeService.getDoc(alphaDoc.id);
      expect(chunk?.text).toBe(
        doc.content.slice(chunk?.startOffset ?? 0, chunk?.endOffset ?? 0),
      );
    },
  );
});
