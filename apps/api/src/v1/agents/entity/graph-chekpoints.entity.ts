import {
  Entity,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'graph_checkpoints' })
@Unique({ properties: ['threadId', 'checkpointNs', 'checkpointId'] })
export class GraphCheckpointEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'varchar' })
  threadId!: string;

  @Property({ type: 'varchar', nullable: true })
  @Index()
  parentThreadId!: string | null;

  @Property({ type: 'varchar', nullable: true })
  @Index()
  nodeId!: string | null;

  @Property({ type: 'varchar', default: '' })
  checkpointNs!: string;

  @Property({ type: 'varchar' })
  checkpointId!: string;

  @Property({ type: 'varchar', nullable: true })
  parentCheckpointId!: string | null;

  @Property({ type: 'varchar' })
  type!: string;

  @Property({ type: 'blob', columnType: 'bytea' })
  checkpoint!: Buffer;

  @Property({ type: 'blob', columnType: 'bytea' })
  metadata!: Buffer;

  @Property({ type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date();

  @Property({
    type: 'timestamptz',
    defaultRaw: 'now()',
    onUpdate: () => new Date(),
  })
  updatedAt: Date = new Date();
}
