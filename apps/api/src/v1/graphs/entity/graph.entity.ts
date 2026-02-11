import { TimestampsEntity } from '@packages/typeorm';
import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { ThreadEntity } from '../../threads/entity/thread.entity';
import { type GraphSchemaType, GraphStatus } from '../graphs.types';

@Entity('graphs')
export class GraphEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @OneToMany('ThreadEntity', 'graph')
  threads?: ThreadEntity[];

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ type: 'varchar', length: 50 })
  version!: string;

  @Column({ type: 'varchar', length: 50 })
  targetVersion!: string;

  @Column({ type: 'jsonb' })
  schema!: GraphSchemaType;

  @Column({
    type: 'enum',
    enum: GraphStatus,
    default: GraphStatus.Created,
  })
  @Index()
  status!: GraphStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({
    type: 'uuid',
  })
  @Index()
  createdBy!: string;

  @Column({ type: 'boolean', default: false })
  temporary!: boolean;
}
