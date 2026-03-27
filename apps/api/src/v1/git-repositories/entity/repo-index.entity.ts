import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { TimestampsEntity } from '@packages/mikroorm';

import { RepoIndexStatus } from '../git-repositories.types';
import { GitRepositoryEntity } from './git-repository.entity';

@Entity({ tableName: 'repo_indexes' })
@Index({ properties: ['status'] })
@Unique({ properties: ['repositoryId', 'branch'] })
export class RepoIndexEntity extends TimestampsEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'uuid' })
  repositoryId!: string;

  @ManyToOne(() => GitRepositoryEntity, {
    deleteRule: 'cascade',
    nullable: true,
  })
  repository?: GitRepositoryEntity;

  @Property({ type: 'varchar' })
  repoUrl!: string;

  @Property({ type: 'varchar' })
  branch!: string;

  @Enum({ items: () => RepoIndexStatus })
  status!: RepoIndexStatus;

  @Property({ type: 'varchar' })
  qdrantCollection!: string;

  @Property({ type: 'varchar', nullable: true })
  lastIndexedCommit!: string | null;

  @Property({ type: 'varchar', nullable: true })
  embeddingModel!: string | null;

  @Property({ type: 'int', nullable: true })
  vectorSize!: number | null;

  @Property({ type: 'varchar', nullable: true })
  chunkingSignatureHash!: string | null;

  @Property({ type: 'int', default: 0 })
  estimatedTokens!: number;

  @Property({ type: 'int', default: 0 })
  indexedTokens!: number;

  @Property({ type: 'text', nullable: true })
  errorMessage!: string | null;
}
