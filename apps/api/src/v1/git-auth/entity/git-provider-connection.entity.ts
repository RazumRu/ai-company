import { TimestampsEntity } from '@packages/typeorm';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

import { GitProvider } from '../git-auth.types';

@Entity('git_provider_connections')
@Unique(['userId', 'provider', 'accountLogin'])
export class GitProviderConnectionEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  @Index()
  userId!: string;

  @Column({ type: 'varchar', default: GitProvider.GitHub })
  @Index()
  provider!: GitProvider;

  @Column({ type: 'varchar' })
  accountLogin!: string;

  @Column({ type: 'jsonb', nullable: true, default: '{}' })
  metadata!: Record<string, unknown>;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
