import {
  Entity,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { TimestampsEntity } from '@packages/mikroorm';

import type { Settings } from '../../cost-limits/cost-limit-settings.schema';

@Entity({ tableName: 'projects' })
export class ProjectEntity extends TimestampsEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'varchar', length: 255 })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'varchar', length: 50, nullable: true })
  icon?: string | null;

  @Property({ type: 'varchar', length: 20, nullable: true })
  color?: string | null;

  @Property({ type: 'jsonb', default: '{}' })
  settings!: Settings;

  @Property({ type: 'varchar' })
  @Index()
  createdBy!: string;
}
