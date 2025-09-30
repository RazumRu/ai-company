import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'graph_checkpoint_writes' })
@Index(['threadId', 'checkpointNs', 'checkpointId', 'taskId', 'idx'], {
  unique: true,
})
export class GraphCheckpointWritesEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  threadId!: string;

  @Column({ type: 'varchar', default: '' })
  checkpointNs!: string;

  @Column({ type: 'varchar' })
  checkpointId!: string;

  @Column({ type: 'varchar' })
  taskId!: string;

  @Column({ type: 'integer' })
  idx!: number;

  @Column({ type: 'varchar' })
  channel!: string;

  @Column({ type: 'varchar' })
  type!: string;

  @Column({ type: 'bytea' })
  value!: Buffer;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
