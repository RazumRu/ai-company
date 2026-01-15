import { TimestampsEntity } from '@packages/typeorm';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { RuntimeStartParams } from '../runtime.types';
import { RuntimeInstanceStatus, RuntimeType } from '../runtime.types';

@Entity('runtime_instances')
@Index(['graphId', 'nodeId', 'threadId'], { unique: true })
export class RuntimeInstanceEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  graphId!: string;

  @Column({ type: 'varchar' })
  nodeId!: string;

  @Column({ type: 'varchar' })
  @Index()
  threadId!: string;

  @Column({
    type: 'enum',
    enum: RuntimeType,
  })
  type!: RuntimeType;

  @Column({ type: 'varchar', length: 255 })
  containerName!: string;

  @Column({
    type: 'enum',
    enum: RuntimeInstanceStatus,
    default: RuntimeInstanceStatus.Starting,
  })
  @Index()
  status!: RuntimeInstanceStatus;

  @Column({ type: 'jsonb' })
  config!: RuntimeStartParams;

  @Column({ type: 'boolean', default: false })
  @Index('IDX_runtime_instances_temporary')
  temporary!: boolean;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  @Index()
  lastUsedAt!: Date;
}
