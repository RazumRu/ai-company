import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { QdrantService } from '../../../v1/qdrant/services/qdrant.service';
import { createTestModule } from '../setup';

describe('QdrantService (integration)', () => {
  let app: INestApplication;
  let qdrantService: QdrantService;

  const createCollectionName = () =>
    `test_qdrant_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const cleanupCollection = async (name: string) => {
    try {
      await qdrantService.raw.deleteCollection(name);
    } catch {
      // ignore cleanup errors
    }
  };

  const createCollection = async (name: string, size: number) => {
    await cleanupCollection(name);
    await qdrantService.raw.createCollection(name, {
      vectors: { size, distance: 'Cosine' },
    });
  };

  beforeAll(async () => {
    app = await createTestModule();
    qdrantService = app.get(QdrantService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('upserts and searches points', async () => {
    const collection = createCollectionName();
    await createCollection(collection, 2);

    const chunk1 = randomUUID();
    const chunk2 = randomUUID();

    await qdrantService.upsertPoints(collection, [
      {
        id: chunk1,
        vector: [0.1, 0.2],
        payload: { docId: 'doc-1', text: 'alpha' },
      },
      {
        id: chunk2,
        vector: [0.2, 0.1],
        payload: { docId: 'doc-1', text: 'beta' },
      },
    ]);

    const results = await qdrantService.searchPoints(
      collection,
      [0.1, 0.2],
      2,
      {
        with_payload: true,
      },
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((item) => String(item.id) === chunk1)).toBe(true);

    await cleanupCollection(collection);
  });

  it('ensures collection exists', async () => {
    const collection = createCollectionName();
    await cleanupCollection(collection);

    await qdrantService.ensureCollection(collection, 2, 'Cosine');

    const info = await qdrantService.raw.getCollection(collection);
    const vectors = info.config.params.vectors;
    const vectorSize =
      vectors && 'size' in vectors
        ? vectors.size
        : Object.values(vectors ?? {})[0]?.size;
    expect(vectorSize).toBe(2);

    await cleanupCollection(collection);
  });

  it('runs batch searches', async () => {
    const collection = createCollectionName();
    await createCollection(collection, 2);

    const chunk1 = randomUUID();
    const chunk2 = randomUUID();

    await qdrantService.upsertPoints(collection, [
      {
        id: chunk1,
        vector: [0.1, 0.2],
        payload: { docId: 'doc-1', text: 'alpha' },
      },
      {
        id: chunk2,
        vector: [0.2, 0.1],
        payload: { docId: 'doc-1', text: 'beta' },
      },
    ]);

    const results = await qdrantService.searchMany(collection, [
      { vector: [0.1, 0.2], limit: 1, with_payload: true },
      { vector: [0.2, 0.1], limit: 1, with_payload: true },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.length).toBeGreaterThan(0);
    expect(results[1]?.length).toBeGreaterThan(0);

    await cleanupCollection(collection);
  });

  it('retrieves points by ids', async () => {
    const collection = createCollectionName();
    await createCollection(collection, 2);

    const chunk1 = randomUUID();

    await qdrantService.upsertPoints(collection, [
      {
        id: chunk1,
        vector: [0.1, 0.2],
        payload: { docId: 'doc-1', text: 'alpha' },
      },
    ]);

    const results = await qdrantService.retrievePoints(collection, {
      ids: [chunk1],
      with_payload: true,
    });

    expect(results).toHaveLength(1);
    expect(String(results[0]?.id)).toBe(chunk1);

    await cleanupCollection(collection);
  });

  it('scrolls through all points', async () => {
    const collection = createCollectionName();
    await createCollection(collection, 2);

    const chunk1 = randomUUID();
    const chunk2 = randomUUID();
    const chunk3 = randomUUID();

    await qdrantService.upsertPoints(collection, [
      {
        id: chunk1,
        vector: [0.1, 0.2],
        payload: { docId: 'doc-1', text: 'alpha' },
      },
      {
        id: chunk2,
        vector: [0.2, 0.1],
        payload: { docId: 'doc-1', text: 'beta' },
      },
      {
        id: chunk3,
        vector: [0.3, 0.4],
        payload: { docId: 'doc-1', text: 'gamma' },
      },
    ]);

    const results = await qdrantService.scrollAll(collection, {
      filter: { must: [{ key: 'docId', match: { value: 'doc-1' } }] },
      limit: 1,
      with_payload: true,
    } as Parameters<QdrantService['scrollAll']>[1]);

    expect(results).toHaveLength(3);

    await cleanupCollection(collection);
  });

  it('deletes points by filter', async () => {
    const collection = createCollectionName();
    await createCollection(collection, 2);

    const chunk1 = randomUUID();
    const chunk2 = randomUUID();

    await qdrantService.upsertPoints(collection, [
      {
        id: chunk1,
        vector: [0.1, 0.2],
        payload: { docId: 'doc-1', text: 'alpha' },
      },
      {
        id: chunk2,
        vector: [0.2, 0.1],
        payload: { docId: 'doc-2', text: 'beta' },
      },
    ]);

    await qdrantService.deleteByFilter(collection, {
      must: [{ key: 'docId', match: { value: 'doc-1' } }],
    });

    const results = await qdrantService.retrievePoints(collection, {
      ids: [chunk1],
      with_payload: true,
    });

    expect(results).toHaveLength(0);

    await cleanupCollection(collection);
  });
});
