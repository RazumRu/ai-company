import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'graph_checkpoint_writes' })
@Unique({
  properties: ['threadId', 'checkpointNs', 'checkpointId', 'taskId', 'idx'],
})
export class GraphCheckpointWritesEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'varchar' })
  threadId!: string;

  @Property({ type: 'varchar', default: '' })
  checkpointNs!: string;

  @Property({ type: 'varchar' })
  checkpointId!: string;

  @Property({ type: 'varchar' })
  taskId!: string;

  @Property({ type: 'integer' })
  idx!: number;

  @Property({ type: 'varchar' })
  channel!: string;

  @Property({ type: 'varchar' })
  type!: string;

  @Property({ type: 'blob', columnType: 'bytea' })
  value!: Buffer;

  @Property({ type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date();

  @Property({
    type: 'timestamptz',
    defaultRaw: 'now()',
    onUpdate: () => new Date(),
  })
  updatedAt: Date = new Date();
}
