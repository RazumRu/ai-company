import {
  Entity,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { TimestampsEntity } from '@packages/mikroorm';

import { GitProvider } from '../git-auth.types';

@Entity({ tableName: 'git_provider_connections' })
@Unique({ properties: ['userId', 'provider', 'accountLogin'] })
export class GitProviderConnectionEntity extends TimestampsEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'varchar' })
  @Index()
  userId!: string;

  @Property({ type: 'varchar', default: GitProvider.GitHub })
  @Index()
  provider!: GitProvider;

  @Property({ type: 'varchar' })
  accountLogin!: string;

  @Property({ type: 'jsonb', nullable: true, default: '{}' })
  metadata!: Record<string, unknown>;

  @Property({ type: 'boolean', default: true })
  isActive!: boolean;
}
