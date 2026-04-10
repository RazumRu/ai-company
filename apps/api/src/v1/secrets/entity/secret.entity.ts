import {
  Entity,
  Filter,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

import { AuditEntity } from '../../../auth/audit.entity';

@Entity({ tableName: 'secrets' })
@Filter({ name: 'softDelete', cond: { deletedAt: null }, default: true })
@Unique({ properties: ['projectId', 'name'] })
export class SecretEntity extends AuditEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'string', length: 255 })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description?: string | null;
}
