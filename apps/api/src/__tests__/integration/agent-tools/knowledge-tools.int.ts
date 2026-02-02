import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import {
  KnowledgeGetChunksOutput,
  KnowledgeGetChunksTool,
} from '../../../v1/agent-tools/tools/common/knowledge/knowledge-get-chunks.tool';
import { KnowledgeGetDocTool } from '../../../v1/agent-tools/tools/common/knowledge/knowledge-get-doc.tool';
import { KnowledgeSearchChunksTool } from '../../../v1/agent-tools/tools/common/knowledge/knowledge-search-chunks.tool';
import { KnowledgeSearchDocsTool } from '../../../v1/agent-tools/tools/common/knowledge/knowledge-search-docs.tool';
import { KnowledgeDocDao } from '../../../v1/knowledge/dao/knowledge-doc.dao';
import { KnowledgeService } from '../../../v1/knowledge/services/knowledge.service';
import { QdrantService } from '../../../v1/qdrant/services/qdrant.service';
import { createTestModule, TEST_USER_ID } from '../setup';

describe('Knowledge tools (integration)', () => {
  let app: INestApplication;
  let knowledgeService: KnowledgeService;
  let searchDocsTool: KnowledgeSearchDocsTool;
  let searchChunksTool: KnowledgeSearchChunksTool;
  let getChunksTool: KnowledgeGetChunksTool;
  let getDocTool: KnowledgeGetDocTool;
  let docDao: KnowledgeDocDao;
  let qdrantService: QdrantService;
  const testUserId = TEST_USER_ID;
  const createdDocIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    knowledgeService = app.get(KnowledgeService);
    searchDocsTool = await app.resolve(KnowledgeSearchDocsTool);
    searchChunksTool = await app.resolve(KnowledgeSearchChunksTool);
    getChunksTool = await app.resolve(KnowledgeGetChunksTool);
    getDocTool = await app.resolve(KnowledgeGetDocTool);
    docDao = app.get(KnowledgeDocDao);
    qdrantService = app.get(QdrantService);
    const dataSource = app.get(DataSource);
    await dataSource.synchronize();
  }, 120_000);

  afterEach(async () => {
    for (const id of createdDocIds) {
      await docDao.deleteById(id);
    }
    createdDocIds.length = 0;
  });

  afterAll(async () => {
    const collectionName =
      environment.knowledgeChunksCollection ?? 'knowledge_chunks';
    const collections = await qdrantService.raw.getCollections();
    const exists = collections.collections.some(
      (collection) => collection.name === collectionName,
    );
    if (exists) {
      await qdrantService.raw.deleteCollection(collectionName);
    }
    await app?.close();
  });

  it(
    'returns matching docs and summaries with strict tag filters',
    { timeout: 60000 },
    async () => {
      const alphaKeyword = 'zephyrox';
      const betaKeyword = 'umbracore';
      const alphaContent = `Alpha document content ${alphaKeyword}`;
      const betaContent = `Beta document content ${betaKeyword}`;
      const alphaTag = `alpha-tag-${randomUUID()}`;
      const betaTag = `beta-tag-${randomUUID()}`;
      const alphaDoc = await knowledgeService.createDoc({
        title: 'Alpha doc',
        content: alphaContent,
        tags: [alphaTag],
      });
      const betaDoc = await knowledgeService.createDoc({
        title: 'Beta doc',
        content: betaContent,
        tags: [betaTag],
      });
      createdDocIds.push(alphaDoc.id, betaDoc.id);

      expect(alphaDoc.summary).toBeTruthy();
      expect(betaDoc.summary).toBeTruthy();

      const refreshedAlpha = await knowledgeService.getDoc(alphaDoc.id);
      expect(refreshedAlpha.tags).toEqual([alphaTag]);

      const searchResult = await searchDocsTool.invoke(
        {
          task: `Find alpha-tag doc. Stack: NestJS + TypeScript. Keyword: ${alphaKeyword}`,
        },
        { tags: [alphaTag] },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: testUserId,
          },
        },
      );

      const output = searchResult.output as {
        documents: {
          documentPublicId: number;
          title: string;
          summary: string | null;
          tags: string[];
        }[];
        comment?: string;
      };
      expect(output.documents).toHaveLength(1);
      expect(output.documents[0]?.documentPublicId).toBe(alphaDoc.publicId);
      expect(output.documents[0]?.summary).toBe(refreshedAlpha.summary);
      expect(output.documents[0]?.tags).toEqual([alphaTag]);
    },
  );

  it(
    'searches chunks and returns exact content slices',
    { timeout: 60000 },
    async () => {
      const keyword = 'zephyrox';
      const content = `Alpha document content ${keyword} and more text.`;
      const doc = await knowledgeService.createDoc({
        title: 'Alpha doc',
        content,
        tags: ['alpha-tag'],
      });
      createdDocIds.push(doc.id);

      const chunksResult = await searchChunksTool.invoke(
        { docIds: [doc.publicId], query: keyword, topK: 3 },
        { tags: ['alpha-tag'] },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: testUserId,
          },
        },
      );

      const chunkSnippets = chunksResult.output;
      expect(chunkSnippets.length).toBeGreaterThan(0);
      expect(chunkSnippets[0]?.docPublicId).toBe(doc.publicId);
      expect(chunkSnippets[0]?.snippet.toLowerCase()).toContain(keyword);

      const chunkResult = await getChunksTool.invoke(
        { chunkIds: [chunkSnippets[0]!.chunkPublicId] },
        { tags: ['alpha-tag'] },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: testUserId,
          },
        },
      );

      const chunks: KnowledgeGetChunksOutput = chunkResult.output;
      expect(chunks).toHaveLength(1);
      const chunk = chunks[0];
      expect(chunk?.docPublicId).toBe(doc.publicId);

      const refreshed = await knowledgeService.getDoc(doc.id);
      expect(chunk?.text).toBe(
        refreshed.content.slice(chunk?.startOffset ?? 0, chunk?.endOffset ?? 0),
      );
    },
  );

  it('updates summaries when content changes', { timeout: 60000 }, async () => {
    const originalKeyword = 'orionflux';
    const updatedKeyword = 'novaquill';
    const original = await knowledgeService.createDoc({
      title: 'Original doc',
      content: `Original content ${originalKeyword}.`,
    });
    createdDocIds.push(original.id);
    expect(original.summary).toBeTruthy();

    const updated = await knowledgeService.updateDoc(original.id, {
      title: 'Updated doc',
      content: `Updated content ${updatedKeyword}.`,
    });

    expect(updated.summary).toBeTruthy();
    expect(updated.summary).not.toBe(original.summary);
    expect(updated.updatedAt).not.toBe(original.updatedAt);
  });

  it(
    'filters chunk search and retrieval by tags',
    { timeout: 60000 },
    async () => {
      const alphaKeyword = 'solaris';
      const betaKeyword = 'umbria';
      const alphaDoc = await knowledgeService.createDoc({
        title: 'Alpha doc',
        content: `Alpha content ${alphaKeyword}.`,
        tags: ['alpha-tag'],
      });
      const betaDoc = await knowledgeService.createDoc({
        title: 'Beta doc',
        content: `Beta content ${betaKeyword}.`,
        tags: ['beta-tag'],
      });
      createdDocIds.push(alphaDoc.id, betaDoc.id);

      const chunksResult = await searchChunksTool.invoke(
        {
          docIds: [alphaDoc.publicId, betaDoc.publicId],
          query: alphaKeyword,
          topK: 5,
        },
        { tags: ['alpha-tag'] },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: testUserId,
          },
        },
      );

      const chunkSnippets = chunksResult.output as {
        chunkPublicId: number;
        docPublicId: number | null;
        score: number;
        snippet: string;
      }[];
      expect(chunkSnippets.length).toBeGreaterThan(0);
      expect(
        chunkSnippets.every((chunk) => chunk.docPublicId === alphaDoc.publicId),
      ).toBe(true);

      const allowedChunks = await getChunksTool.invoke(
        { chunkIds: [chunkSnippets[0]!.chunkPublicId] },
        { tags: ['alpha-tag'] },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: testUserId,
          },
        },
      );
      const allowedOutput: KnowledgeGetChunksOutput = allowedChunks.output;
      expect(allowedOutput).toHaveLength(1);
      expect(allowedOutput[0]?.docPublicId).toBe(alphaDoc.publicId);

      const blockedChunks = await getChunksTool.invoke(
        { chunkIds: [chunkSnippets[0]!.chunkPublicId] },
        { tags: ['beta-tag'] },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: testUserId,
          },
        },
      );
      const blockedOutput: KnowledgeGetChunksOutput = blockedChunks.output;
      expect(blockedOutput).toHaveLength(0);
    },
  );

  it(
    'returns full doc content only when politic allows it',
    { timeout: 60000 },
    async () => {
      const allowedDoc = await knowledgeService.createDoc({
        title: 'Allowed doc',
        content: 'Full content is allowed here.',
        politic:
          'If this document is relevant to the current task - always fetch the full content instead of fetching only specific chunks.',
      });
      const blockedDoc = await knowledgeService.createDoc({
        title: 'Blocked doc',
        content: 'This should not be returned.',
        politic: 'Summarize only; do not share full content.',
      });
      createdDocIds.push(allowedDoc.id, blockedDoc.id);

      const allowedResult = await getDocTool.invoke(
        { docId: allowedDoc.publicId },
        {},
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: testUserId,
          },
        },
      );

      expect(allowedResult.output).toBeTruthy();
      expect(allowedResult.output?.documentPublicId).toBe(allowedDoc.publicId);
      expect(allowedResult.output?.content).toBe(allowedDoc.content);

      await expect(
        getDocTool.invoke(
          { docId: blockedDoc.publicId },
          {},
          {
            configurable: {
              thread_id: 'thread-1',
              graph_created_by: testUserId,
            },
          },
        ),
      ).rejects.toThrowError('FULL_CONTENT_NOT_ALLOWED');
    },
  );
});
