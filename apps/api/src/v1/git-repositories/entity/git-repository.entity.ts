import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { TimestampsEntity } from '@packages/mikroorm';

import { GitRepositoryProvider } from '../git-repositories.types';

@Entity({ tableName: 'git_repositories' })
@Unique({ properties: ['owner', 'repo', 'createdBy', 'provider'] })
export class GitRepositoryEntity extends TimestampsEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'varchar' })
  @Index()
  createdBy!: string;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  projectId!: string | null;

  @Property({ type: 'varchar' })
  @Index()
  owner!: string;

  @Property({ type: 'varchar' })
  @Index()
  repo!: string;

  @Property({ type: 'varchar' })
  url!: string;

  @Enum({ items: () => GitRepositoryProvider })
  provider!: GitRepositoryProvider;

  @Property({ type: 'varchar', default: 'main' })
  defaultBranch!: string;

  @Property({ type: 'int', nullable: true })
  installationId!: number | null;

  @Property({ type: 'timestamptz', nullable: true })
  syncedAt!: Date | null;
}
