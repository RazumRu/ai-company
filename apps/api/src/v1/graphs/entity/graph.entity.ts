import { TimestampsEntity } from '@packages/typeorm';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { type GraphSchemaType, GraphStatus } from '../graphs.types';

@Entity('graphs')
export class GraphEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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
