import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { TimestampsEntity } from '@packages/mikroorm';
import type { Operation } from 'fast-json-patch';

import type { GraphSchemaType } from '../graphs.types';
import { GraphRevisionStatus } from '../graphs.types';

export type GraphRevisionConfig = {
  schema: GraphSchemaType;
  name: string;
  description: string | null;
  temporary: boolean;
};

@Entity({ tableName: 'graph_revisions' })
@Index({ properties: ['graphId', 'toVersion'] })
export class GraphRevisionEntity extends TimestampsEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'uuid' })
  @Index()
  graphId!: string;

  @Property({ length: 50 })
  baseVersion!: string;

  @Property({ length: 50 })
  toVersion!: string;

  @Property({ type: 'jsonb' })
  configDiff!: Operation[];

  @Property({ type: 'jsonb' })
  clientConfig!: GraphRevisionConfig;

  @Property({ type: 'jsonb' })
  newConfig!: GraphRevisionConfig;

  @Enum({
    items: () => GraphRevisionStatus,
    default: GraphRevisionStatus.Pending,
  })
  @Index()
  status!: GraphRevisionStatus;

  @Property({ type: 'text', nullable: true })
  error?: string;

  @Property({ type: 'varchar' })
  @Index()
  createdBy!: string;
}
