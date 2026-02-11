import { TimestampsEntity } from '@packages/typeorm';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { GraphEntity } from '../../graphs/entity/graph.entity';
import { ThreadStatus } from '../threads.types';
import type { MessageEntity } from './message.entity';

@Entity('threads')
export class ThreadEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  graphId!: string;

  @ManyToOne('GraphEntity', 'threads', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'graphId' })
  graph?: GraphEntity;

  @OneToMany('MessageEntity', 'thread')
  messages?: MessageEntity[];

  @Column({ type: 'uuid' })
  @Index()
  createdBy!: string;

  @Column({ type: 'varchar' })
  @Index({
    unique: true,
  })
  externalThreadId!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ type: 'varchar', nullable: true })
  source?: string;

  @Column({ type: 'varchar', nullable: true })
  name?: string;

  @Column({ type: 'varchar', default: ThreadStatus.Running })
  @Index()
  status!: ThreadStatus;

  @Column({ type: 'uuid', nullable: true })
  lastRunId?: string;
}
