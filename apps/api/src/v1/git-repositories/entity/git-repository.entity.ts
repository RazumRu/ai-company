import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { AuditEntity } from '../../../auth/audit.entity';
import { GitRepositoryProvider } from '../git-repositories.types';

@Entity('git_repositories')
@Index(['owner', 'repo', 'createdBy', 'provider', 'projectId'], { unique: true })
export class GitRepositoryEntity extends AuditEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  @Index()
  owner!: string;

  @Column({ type: 'varchar' })
  @Index()
  repo!: string;

  @Column({ type: 'varchar' })
  url!: string;

  @Column({
    type: 'enum',
    enum: GitRepositoryProvider,
  })
  provider!: GitRepositoryProvider;

  @Column({ type: 'varchar', default: 'main' })
  defaultBranch!: string;

  @Column({ type: 'int', nullable: true })
  installationId!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  syncedAt!: Date | null;
}
