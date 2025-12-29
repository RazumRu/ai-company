import { TimestampsEntity } from '@packages/typeorm';
import type { Operation } from 'fast-json-patch';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { GraphSchemaType } from '../graphs.types';
import { GraphRevisionStatus } from '../graphs.types';

export type GraphRevisionConfig = {
  schema: GraphSchemaType;
  name: string;
  description: string | null;
  temporary: boolean;
};

@Entity('graph_revisions')
@Index(['graphId', 'toVersion']) // For finding revisions by version
export class GraphRevisionEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  graphId!: string;

  @Column({ type: 'varchar', length: 50 })
  baseVersion!: string;

  @Column({ type: 'varchar', length: 50 })
  toVersion!: string;

  @Column({ type: 'jsonb' })
  configDiff!: Operation[];

  @Column({ type: 'jsonb' })
  clientConfig!: GraphRevisionConfig;

  @Column({ type: 'jsonb' })
  newConfig!: GraphRevisionConfig;

  @Column({
    type: 'enum',
    enum: GraphRevisionStatus,
    default: GraphRevisionStatus.Pending,
  })
  @Index()
  status!: GraphRevisionStatus;

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ type: 'uuid' })
  @Index()
  createdBy!: string;
}
