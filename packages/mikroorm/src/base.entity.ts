import { Filter, Property } from '@mikro-orm/decorators/legacy';

@Filter({ name: 'softDelete', cond: { deletedAt: null }, default: true })
export abstract class TimestampsEntity {
  @Property({ type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date();

  @Property({
    type: 'timestamptz',
    defaultRaw: 'now()',
    onUpdate: () => new Date(),
  })
  updatedAt: Date = new Date();

  @Property({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null = null;
}
