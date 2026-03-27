import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { TimestampsEntity } from '@packages/mikroorm';

import type { RuntimeStartParams } from '../runtime.types';
import { RuntimeInstanceStatus, RuntimeType } from '../runtime.types';

@Entity({ tableName: 'runtime_instances' })
@Index({
  properties: ['graphId', 'nodeId', 'threadId'],
  options: { unique: true },
})
export class RuntimeInstanceEntity extends TimestampsEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  graphId!: string | null;

  @Property({ type: 'varchar' })
  nodeId!: string;

  @Property({ type: 'varchar' })
  @Index()
  threadId!: string;

  @Enum({ items: () => RuntimeType })
  type!: RuntimeType;

  @Property({ length: 255 })
  containerName!: string;

  @Enum({
    items: () => RuntimeInstanceStatus,
    default: RuntimeInstanceStatus.Starting,
  })
  @Index()
  status!: RuntimeInstanceStatus;

  @Property({ type: 'jsonb' })
  config!: RuntimeStartParams;

  @Property({ type: 'boolean', default: false })
  @Index({ name: 'IDX_runtime_instances_temporary' })
  temporary!: boolean;

  @Property({ type: 'timestamptz', defaultRaw: 'CURRENT_TIMESTAMP' })
  @Index()
  lastUsedAt!: Date;
}
