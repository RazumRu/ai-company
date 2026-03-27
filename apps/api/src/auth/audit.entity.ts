import { Index, Property } from '@mikro-orm/decorators/legacy';
import { TimestampsEntity } from '@packages/mikroorm';

export abstract class AuditEntity extends TimestampsEntity {
  @Property({ type: 'varchar' })
  @Index()
  createdBy!: string;

  @Property({ type: 'uuid' })
  @Index()
  projectId!: string;
}
