import { TimestampsEntity } from '@packages/typeorm';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { RepoIndexStatus } from '../git-repositories.types';

@Entity('repo_indexes')
@Index(['status']) // For efficient queries by status (e.g., recovering stuck jobs)
export class RepoIndexEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  repositoryId!: string;

  @Column({ type: 'varchar' })
  repoUrl!: string;

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

  @Column({ type: 'int', nullable: true })
  estimatedTokens!: number | null;

  @Column({ type: 'int', nullable: true, default: 0 })
  indexedTokens!: number | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;
}
