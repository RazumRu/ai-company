import { Injectable } from '@nestjs/common';
import { InternalException } from '@packages/common';
import { QdrantClient } from '@qdrant/js-client-rest';

import { environment } from '../../../environments';

type Distance = 'Cosine' | 'Dot' | 'Euclid' | 'Manhattan';

type UpsertArgs = Parameters<QdrantClient['upsert']>[1];
type UpsertPoints = Extract<UpsertArgs, { points: unknown }>['points'];

type SearchArgs = Parameters<QdrantClient['search']>[1];
type SearchFilter = SearchArgs extends { filter?: infer F } ? F : unknown;
type SearchResultItem = Awaited<ReturnType<QdrantClient['search']>>[number];

type SearchBatchArgs = Parameters<QdrantClient['searchBatch']>[1];
type SearchBatchItem = SearchBatchArgs['searches'][number];

type RetrieveArgs = Parameters<QdrantClient['retrieve']>[1];
type RetrieveResultItem = Awaited<ReturnType<QdrantClient['retrieve']>>[number];

type ScrollArgs = Parameters<QdrantClient['scroll']>[1];
type ScrollResult = Awaited<ReturnType<QdrantClient['scroll']>>;
type ScrollOffset = ScrollResult['next_page_offset'];

type DeleteArgs = Parameters<QdrantClient['delete']>[1];
type DeleteFilter = Extract<DeleteArgs, { filter: unknown }>['filter'];

type CollectionInfo = Awaited<ReturnType<QdrantClient['getCollection']>>;

@Injectable()
export class QdrantService {
  private readonly client: QdrantClient;
  private readonly vectorSizeCache = new Map<string, number>();

  constructor() {
    const url = environment.qdrantUrl;
    if (!url) throw new InternalException('QDRANT_URL_MISSING');

    this.client = new QdrantClient({
      url,
      apiKey: environment.qdrantApiKey,
    });
  }

  get raw() {
    return this.client;
  }

  async ensureCollection(
    name: string,
    vectorSize: number,
    distance: Distance = 'Cosine',
  ): Promise<void> {
    const cached = this.vectorSizeCache.get(name);
    if (cached === vectorSize) {
      return;
    }

    const exists = await this.collectionExists(name);
    if (!exists) {
      await this.client.createCollection(name, {
        vectors: { size: vectorSize, distance },
      });
      this.vectorSizeCache.set(name, vectorSize);
      return;
    }

    const existingSize = await this.getCollectionVectorSize(name);
    if (existingSize === null) {
      return;
    }

    if (existingSize !== vectorSize) {
      throw new InternalException('QDRANT_VECTOR_SIZE_MISMATCH', {
        expected: existingSize,
        actual: vectorSize,
      });
    }

    this.vectorSizeCache.set(name, existingSize);
  }

  async upsertPoints(
    collection: string,
    points: UpsertPoints,
    opts?: {
      wait?: boolean;
      ordering?: UpsertArgs['ordering'];
      distance?: Distance;
    },
  ): Promise<void> {
    if (!points.length) {
      return;
    }

    const vectorSize = this.extractVectorSize(points[0]);
    await this.ensureCollection(
      collection,
      vectorSize,
      opts?.distance ?? 'Cosine',
    );

    await this.client.upsert(collection, {
      wait: opts?.wait ?? true,
      ordering: opts?.ordering,
      points,
    });
  }

  private extractVectorSize(point: unknown): number {
    const vector = (point as { vector?: unknown }).vector;

    if (!Array.isArray(vector) || typeof vector[0] !== 'number') {
      throw new InternalException('QDRANT_VECTOR_MISSING');
    }

    return vector.length;
  }

  async deleteByFilter(
    collection: string,
    filter: DeleteFilter,
    opts?: { wait?: boolean },
  ): Promise<void> {
    const exists = await this.collectionExists(collection);
    if (!exists) {
      return;
    }

    await this.client.delete(collection, {
      wait: opts?.wait ?? true,
      filter,
    });
  }

  async searchPoints(
    collection: string,
    vector: number[],
    limit: number,
    opts?: {
      filter?: SearchFilter;
      with_payload?: boolean;
    },
  ): Promise<SearchResultItem[]> {
    if (!vector.length || limit <= 0) {
      return [];
    }

    return this.client.search(collection, {
      vector,
      limit,
      filter: opts?.filter,
      with_payload: opts?.with_payload ?? false,
      with_vector: false,
    } as Omit<SearchArgs, 'with_vector'> & { with_vector: false });
  }

  async searchMany(
    collection: string,
    searches: SearchBatchItem[],
  ): Promise<SearchResultItem[][]> {
    if (!searches.length) {
      return [];
    }
    return this.client.searchBatch(collection, { searches });
  }

  async retrievePoints(
    collection: string,
    args: Omit<RetrieveArgs, 'with_vector'> & { with_vector?: false },
  ): Promise<RetrieveResultItem[]> {
    if (!args.ids?.length) {
      return [];
    }
    const exists = await this.collectionExists(collection);
    if (!exists) {
      return [];
    }

    return this.client.retrieve(collection, {
      ...args,
      with_vector: false,
    });
  }

  async scrollAll(
    collection: string,
    args: Omit<ScrollArgs, 'offset' | 'with_vector'> & {
      limit?: number;
      with_vector?: false;
    },
  ): Promise<ScrollResult['points']> {
    const exists = await this.collectionExists(collection);
    if (!exists) {
      return [];
    }

    const out: ScrollResult['points'] = [];
    let offset: ScrollOffset | undefined;

    while (true) {
      const res = await this.client.scroll(collection, {
        ...args,
        offset,
        with_vector: false,
      });

      out.push(...res.points);

      if (!res.next_page_offset) {
        break;
      }
      offset = res.next_page_offset;
    }

    return out;
  }

  private async collectionExists(name: string): Promise<boolean> {
    const res = await this.client.getCollections();
    return res.collections.some((c) => c.name === name);
  }

  private async getCollectionVectorSize(name: string): Promise<number | null> {
    const info = await this.client.getCollection(name);
    return this.extractVectorSizeFromInfo(info);
  }

  private extractVectorSizeFromInfo(info: CollectionInfo): number | null {
    const vectors = info.config.params.vectors;
    if (!vectors) return null;

    if ('size' in vectors) {
      return typeof vectors.size === 'number' ? vectors.size : null;
    }

    const first = Object.values(vectors)[0];
    if (!first) return null;
    return typeof first.size === 'number' ? first.size : null;
  }
}
