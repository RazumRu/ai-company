import { TimestampsEntity } from '@packages/typeorm';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('threads')
export class ThreadEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  graphId!: string;

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
}
