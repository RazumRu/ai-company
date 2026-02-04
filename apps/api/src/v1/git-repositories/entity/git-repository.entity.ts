import { TimestampsEntity } from '@packages/typeorm';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { GitRepositoryProvider } from '../git-repositories.types';

@Entity('git_repositories')
@Index(['owner', 'repo', 'createdBy', 'provider'], { unique: true })
export class GitRepositoryEntity extends TimestampsEntity {
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

  @Column({ type: 'uuid' })
  @Index()
  createdBy!: string;

  @Column({ type: 'text', nullable: true })
  encryptedToken!: string | null;
}
