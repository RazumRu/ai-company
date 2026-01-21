import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { KnowledgeChunkDao } from '../../../v1/knowledge/dao/knowledge-chunk.dao';
import { KnowledgeDocDao } from '../../../v1/knowledge/dao/knowledge-doc.dao';
import { KnowledgeService } from '../../../v1/knowledge/services/knowledge.service';
import { createTestModule } from '../setup';

describe('KnowledgeService (integration)', () => {
  let app: INestApplication;
  let knowledgeService: KnowledgeService;
  let docDao: KnowledgeDocDao;
  let chunkDao: KnowledgeChunkDao;
  const createdDocIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    knowledgeService = app.get(KnowledgeService);
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

  const expectIsoDate = (value: string) => {
    const parsed = new Date(value);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.toISOString()).toBe(value);
  };

  const expectNormalizedTags = (tags: string[]) => {
    const normalized = tags.map((tag) => tag.trim().toLowerCase());
    expect(tags).toEqual(normalized);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags.length).toBeLessThanOrEqual(12);
  };

  const expectChunksCoverContent = (
    chunks: {
      docId: string;
      chunkIndex: number;
      text: string;
      startOffset: number;
      endOffset: number;
    }[],
    docId: string,
    content: string,
  ) => {
    expect(chunks.length).toBeGreaterThan(0);
    const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    expect(ordered[0]?.chunkIndex).toBe(0);
    expect(ordered[0]?.startOffset).toBe(0);
    let previousEnd = 0;

    ordered.forEach((chunk, index) => {
      expect(chunk.docId).toBe(docId);
      expect(chunk.chunkIndex).toBe(index);
      expect(chunk.startOffset).toBe(previousEnd);
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
      expect(chunk.text).toBe(
        content.slice(chunk.startOffset, chunk.endOffset),
      );
      previousEnd = chunk.endOffset;
    });

    expect(previousEnd).toBe(content.length);
  };

  it(
    'creates a knowledge doc with metadata and chunks',
    { timeout: 30000 },
    async () => {
      const title = 'Alpha doc';
      const content = 'Alpha document content';
      const tags = [' Alpha ', 'BETA'];

      const doc = await knowledgeService.createDoc({ title, content, tags });
      createdDocIds.push(doc.id);

      expect(doc.content).toBe(content);
      expect(doc.title).toBe(title);
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.summary?.length ?? 0).toBeGreaterThan(0);
      expect(doc.tags.length).toBeGreaterThan(0);
      expectNormalizedTags(doc.tags);
      expectIsoDate(doc.createdAt);
      expectIsoDate(doc.updatedAt);

      const chunks = await knowledgeService.getDocChunks(doc.id);
      expectChunksCoverContent(chunks, doc.id, content);
    },
  );

  it('rejects empty content', async () => {
    await expect(
      knowledgeService.createDoc({ title: 'Alpha doc', content: '   ' }),
    ).rejects.toThrow('CONTENT_REQUIRED');
  });

  it(
    'lists docs with tag filtering and supports updates',
    { timeout: 30000 },
    async () => {
      const title = 'Alpha doc';
      const content = 'Alpha document content';
      const tags = ['alpha-tag', 'beta-tag'];

      const doc = await knowledgeService.createDoc({ title, content, tags });
      createdDocIds.push(doc.id);

      const tagsFilter = doc.tags.slice(0, 1);
      expect(tagsFilter.length).toBe(1);

      const results = await knowledgeService.listDocs({
        tags: tagsFilter,
        limit: 10,
        offset: 0,
      });
      expect(results.some((entry) => entry.id === doc.id)).toBe(true);
      results.forEach((entry) => {
        expect(entry.tags).toEqual(
          expect.arrayContaining([tagsFilter[0] as string]),
        );
      });

      const updatedTitle = 'Beta doc';
      const updatedContent = 'Beta document content with new details';

      const updated = await knowledgeService.updateDoc(doc.id, {
        title: updatedTitle,
        content: updatedContent,
      });
      expect(updated.content).toBe(updatedContent);
      expect(updated.title).toBe(updatedTitle);
      expect(updated.title.length).toBeGreaterThan(0);
      expect(updated.summary?.length ?? 0).toBeGreaterThan(0);
      expect(updated.tags).toEqual(doc.tags);
      expectNormalizedTags(updated.tags);
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(updated.createdAt).getTime(),
      );

      const chunks = await knowledgeService.getDocChunks(doc.id);
      expectChunksCoverContent(chunks, doc.id, updatedContent);
    },
  );

  it('deletes docs and rejects missing ids', { timeout: 30000 }, async () => {
    const title = 'Alpha doc';
    const content = 'Alpha document content';
    const tags = ['alpha-tag'];

    const doc = await knowledgeService.createDoc({ title, content, tags });
    createdDocIds.push(doc.id);

    await knowledgeService.deleteDoc(doc.id);
    const remaining = await knowledgeService.listDocs({ limit: 10, offset: 0 });
    expect(remaining.some((entry) => entry.id === doc.id)).toBe(false);

    await expect(knowledgeService.getDoc(doc.id)).rejects.toThrow();
  });
});
