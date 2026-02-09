import { TimestampsEntity } from '@packages/typeorm';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { RepoIndexStatus } from '../git-repositories.types';
import { GitRepositoryEntity } from './git-repository.entity';

@Entity('repo_indexes')
@Index(['status']) // For efficient queries by status (e.g., recovering stuck jobs)
@Index(['repositoryId', 'branch'], { unique: true })
export class RepoIndexEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  repositoryId!: string;

  @ManyToOne(() => GitRepositoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repositoryId' })
  repository?: GitRepositoryEntity;

  @Column({ type: 'varchar' })
  repoUrl!: string;

  @Column({ type: 'varchar' })
  branch!: string;

  @Column({
    type: 'enum',
    enum: RepoIndexStatus,
  })
  status!: RepoIndexStatus;

  @Column({ type: 'varchar' })
  qdrantCollection!: string;

  @Column({ type: 'varchar', nullable: true })
  lastIndexedCommit!: string | null;

  @Column({ type: 'varchar', nullable: true })
  embeddingModel!: string | null;

  @Column({ type: 'int', nullable: true })
  vectorSize!: number | null;

  @Column({ type: 'varchar', nullable: true })
  chunkingSignatureHash!: string | null;

  @Column({ type: 'int', default: 0 })
  estimatedTokens!: number;

  @Column({ type: 'int', default: 0 })
  indexedTokens!: number;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;
}
