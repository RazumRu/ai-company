import {
  Entity,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

import { AuditEntity } from '../../../auth/audit.entity';

@Entity({ tableName: 'knowledge_docs' })
export class KnowledgeDocEntity extends AuditEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'int', autoincrement: true })
  @Unique()
  publicId!: number;

  @Property({ type: 'text' })
  content!: string;

  @Property({ type: 'text' })
  title!: string;

  @Property({ type: 'text', nullable: true })
  summary?: string | null;

  @Property({ type: 'text', nullable: true })
  politic?: string | null;

  @Property({ type: 'text', nullable: true })
  embeddingModel?: string | null;

  @Property({ type: 'jsonb', default: '[]' })
  tags!: string[];
}
