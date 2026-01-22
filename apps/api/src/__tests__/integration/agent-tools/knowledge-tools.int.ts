import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { KnowledgeGetChunksTool } from '../../../v1/agent-tools/tools/common/knowledge/knowledge-get-chunks.tool';
import { KnowledgeGetDocTool } from '../../../v1/agent-tools/tools/common/knowledge/knowledge-get-doc.tool';
import { KnowledgeSearchChunksTool } from '../../../v1/agent-tools/tools/common/knowledge/knowledge-search-chunks.tool';
import { KnowledgeSearchDocsTool } from '../../../v1/agent-tools/tools/common/knowledge/knowledge-search-docs.tool';
import { KnowledgeChunkDao } from '../../../v1/knowledge/dao/knowledge-chunk.dao';
import { KnowledgeDocDao } from '../../../v1/knowledge/dao/knowledge-doc.dao';
import { KnowledgeService } from '../../../v1/knowledge/services/knowledge.service';
import { createTestModule, TEST_USER_ID } from '../setup';

describe('Knowledge tools (integration)', () => {
  let app: INestApplication;
  let knowledgeService: KnowledgeService;
  let searchDocsTool: KnowledgeSearchDocsTool;
  let searchChunksTool: KnowledgeSearchChunksTool;
  let getChunksTool: KnowledgeGetChunksTool;
  let getDocTool: KnowledgeGetDocTool;
  let docDao: KnowledgeDocDao;
  let chunkDao: KnowledgeChunkDao;
  const createdDocIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    knowledgeService = app.get(KnowledgeService);
    searchDocsTool = await app.resolve(KnowledgeSearchDocsTool);
    searchChunksTool = await app.resolve(KnowledgeSearchChunksTool);
    getChunksTool = await app.resolve(KnowledgeGetChunksTool);
    getDocTool = await app.resolve(KnowledgeGetDocTool);
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
    'returns matching docs and summaries with strict tag filters',
    { timeout: 60000 },
    async () => {
      const alphaKeyword = 'zephyrox';
      const betaKeyword = 'umbracore';
      const alphaContent = `Alpha document content ${alphaKeyword}`;
      const betaContent = `Beta document content ${betaKeyword}`;
      const alphaDoc = await knowledgeService.createDoc({
        title: 'Alpha doc',
        content: alphaContent,
        tags: ['alpha-tag'],
      });
      const betaDoc = await knowledgeService.createDoc({
        title: 'Beta doc',
        content: betaContent,
        tags: ['beta-tag'],
      });
      createdDocIds.push(alphaDoc.id, betaDoc.id);

      expect(alphaDoc.summary).toBeTruthy();
      expect(betaDoc.summary).toBeTruthy();

      const refreshedAlpha = await knowledgeService.getDoc(alphaDoc.id);
      expect(refreshedAlpha.tags).toEqual(['alpha-tag']);

      const searchResult = await searchDocsTool.invoke(
        { query: alphaKeyword },
        { tags: ['alpha-tag'] },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: TEST_USER_ID,
          },
        },
      );

      const output = searchResult.output as {
        documentId: string;
        title: string;
        summary: string | null;
        tags: string[];
      }[];
      expect(output).toHaveLength(1);
      expect(output[0]?.documentId).toBe(alphaDoc.id);
      expect(output[0]?.summary).toBe(refreshedAlpha.summary);
      expect(output[0]?.tags).toEqual(['alpha-tag']);
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
        { docIds: [doc.id], query: keyword, topK: 3 },
        { tags: ['alpha-tag'] },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: TEST_USER_ID,
          },
        },
      );

      const chunkSnippets = chunksResult.output as {
        chunkId: string;
        docId: string;
        score: number;
        snippet: string;
      }[];
      expect(chunkSnippets.length).toBeGreaterThan(0);
      expect(chunkSnippets[0]?.docId).toBe(doc.id);
      expect(chunkSnippets[0]?.snippet.toLowerCase()).toContain(keyword);

      const chunkResult = await getChunksTool.invoke(
        { chunkIds: [chunkSnippets[0]!.chunkId] },
        { tags: ['alpha-tag'] },
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
      expect(chunks).toHaveLength(1);
      const chunk = chunks[0];
      expect(chunk?.docId).toBe(doc.id);

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
        { docIds: [alphaDoc.id, betaDoc.id], query: alphaKeyword, topK: 5 },
        { tags: ['alpha-tag'] },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: TEST_USER_ID,
          },
        },
      );

      const chunkSnippets = chunksResult.output as {
        chunkId: string;
        docId: string;
        score: number;
        snippet: string;
      }[];
      expect(chunkSnippets.length).toBeGreaterThan(0);
      expect(chunkSnippets.every((chunk) => chunk.docId === alphaDoc.id)).toBe(
        true,
      );

      const allowedChunks = await getChunksTool.invoke(
        { chunkIds: [chunkSnippets[0]!.chunkId] },
        { tags: ['alpha-tag'] },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: TEST_USER_ID,
          },
        },
      );
      const allowedOutput = allowedChunks.output as {
        id: string;
        docId: string;
      }[];
      expect(allowedOutput).toHaveLength(1);
      expect(allowedOutput[0]?.docId).toBe(alphaDoc.id);

      const blockedChunks = await getChunksTool.invoke(
        { chunkIds: [chunkSnippets[0]!.chunkId] },
        { tags: ['beta-tag'] },
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: TEST_USER_ID,
          },
        },
      );
      expect(blockedChunks.output as unknown[]).toHaveLength(0);
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
        { docId: allowedDoc.id },
        {},
        {
          configurable: {
            thread_id: 'thread-1',
            graph_created_by: TEST_USER_ID,
          },
        },
      );

      expect(allowedResult.output).toBeTruthy();
      expect(allowedResult.output?.documentId).toBe(allowedDoc.id);
      expect(allowedResult.output?.content).toBe(allowedDoc.content);

      await expect(
        getDocTool.invoke(
          { docId: blockedDoc.id },
          {},
          {
            configurable: {
              thread_id: 'thread-1',
              graph_created_by: TEST_USER_ID,
            },
          },
        ),
      ).rejects.toThrowError('FULL_CONTENT_NOT_ALLOWED');
    },
  );
});
