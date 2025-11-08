import { TimestampsEntity } from '@packages/typeorm';
import type { Operation } from 'fast-json-patch';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { GraphSchemaType } from '../graphs.types';
import { GraphRevisionStatus } from '../graphs.types';

@Entity('graph_revisions')
export class GraphRevisionEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  graphId!: string;

  @Column({ type: 'varchar', length: 50 })
  fromVersion!: string;

  @Column({ type: 'varchar', length: 50 })
  toVersion!: string;

  @Column({ type: 'jsonb' })
  configurationDiff!: Operation[];

  @Column({ type: 'jsonb' })
  newSchema!: GraphSchemaType;

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
