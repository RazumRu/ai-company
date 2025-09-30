import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'graph_checkpoints' })
@Index(['threadId', 'checkpointNs', 'checkpointId'], { unique: true })
export class GraphCheckpointEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  threadId!: string;

  @Column({ type: 'varchar', default: '' })
  checkpointNs!: string;

  @Column({ type: 'varchar' })
  checkpointId!: string;

  @Column({ type: 'varchar', nullable: true })
  parentCheckpointId!: string | null;

  @Column({ type: 'varchar' })
  type!: string;

  @Column({ type: 'bytea' })
  checkpoint!: Buffer;

  @Column({ type: 'bytea' })
  metadata!: Buffer;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
