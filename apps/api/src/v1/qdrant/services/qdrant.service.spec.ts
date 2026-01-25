import type { QdrantClient } from '@qdrant/js-client-rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockClient: MockQdrantClient;

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: class {
    constructor() {
      return mockClient as unknown as QdrantClient;
    }
  },
}));

vi.mock('../../../environments', () => ({
  environment: {
    qdrantUrl: 'http://localhost:6333',
    qdrantApiKey: undefined,
  },
}));

import { QdrantService } from './qdrant.service';

type MockQdrantClient = {
  getCollections: ReturnType<typeof vi.fn>;
  getCollection: ReturnType<typeof vi.fn>;
  createCollection: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  searchBatch: ReturnType<typeof vi.fn>;
  retrieve: ReturnType<typeof vi.fn>;
  scroll: ReturnType<typeof vi.fn>;
};

describe('QdrantService', () => {
  let service: QdrantService;

  beforeEach(() => {
    mockClient = {
      getCollections: vi.fn().mockResolvedValue({
        collections: [
          { name: 'test-collection' },
          { name: 'knowledge_chunks' },
        ],
      }),
      getCollection: vi.fn().mockResolvedValue({
        config: { params: { vectors: { size: 2 } } },
      }),
      createCollection: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      search: vi.fn(),
      searchBatch: vi.fn(),
      retrieve: vi.fn(),
      scroll: vi.fn(),
    };

    service = new QdrantService();
  });

  it('upserts points', async () => {
    await service.upsertPoints('test-collection', [
      { id: 'chunk-1', vector: [0.1, 0.2], payload: { docId: 'doc-1' } },
    ]);

    expect(mockClient.upsert).toHaveBeenCalledWith('test-collection', {
      wait: true,
      points: [
        { id: 'chunk-1', vector: [0.1, 0.2], payload: { docId: 'doc-1' } },
      ],
    });
  });

  it('deletes by filter', async () => {
    await service.deleteByFilter('test-collection', {
      must: [{ key: 'docId', match: { value: 'doc-1' } }],
    });

    expect(mockClient.delete).toHaveBeenCalledWith('test-collection', {
      wait: true,
      filter: {
        must: [{ key: 'docId', match: { value: 'doc-1' } }],
      },
    });
  });

  it('returns raw search results', async () => {
    mockClient.search.mockResolvedValue([
      { id: 'chunk-1', score: 0.9 },
      { id: 2, score: 0.7 },
    ]);

    const results = await service.searchPoints(
      'knowledge_chunks',
      [0.1, 0.2],
      5,
    );

    expect(results).toEqual([
      { id: 'chunk-1', score: 0.9 },
      { id: 2, score: 0.7 },
    ]);
  });

  it('returns raw batch results', async () => {
    mockClient.searchBatch.mockResolvedValue([
      [{ id: 'chunk-1', score: 0.9 }],
      [{ id: 'chunk-2', score: 0.6 }],
    ]);

    const results = await service.searchMany('knowledge_chunks', [
      { vector: [0.1, 0.2], limit: 2 },
      { vector: [0.3, 0.4], limit: 2 },
    ]);

    expect(results).toEqual([
      [{ id: 'chunk-1', score: 0.9 }],
      [{ id: 'chunk-2', score: 0.6 }],
    ]);
  });

  it('returns raw retrieve results', async () => {
    mockClient.retrieve.mockResolvedValue([{ id: 'chunk-1' }]);

    const results = await service.retrievePoints('knowledge_chunks', {
      ids: ['chunk-1'],
      with_payload: true,
    });

    expect(results).toEqual([{ id: 'chunk-1' }]);
  });

  it('scrolls through points', async () => {
    mockClient.scroll
      .mockResolvedValueOnce({
        points: [{ id: 'chunk-1' }],
        next_page_offset: 2,
      })
      .mockResolvedValueOnce({
        points: [{ id: 'chunk-2' }],
        next_page_offset: null,
      });

    const results = await service.scrollAll('knowledge_chunks', {
      filter: { must: [{ key: 'docId', match: { value: 'doc-1' } }] },
    } as Parameters<QdrantService['scrollAll']>[1]);

    expect(results).toEqual([{ id: 'chunk-1' }, { id: 'chunk-2' }]);
  });
});
