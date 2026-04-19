import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { TimestampsEntity } from '@packages/mikroorm';

import type { RuntimeStartParams } from '../runtime.types';
import {
  RuntimeErrorCode,
  RuntimeInstanceStatus,
  RuntimeStartingPhase,
  RuntimeType,
} from '../runtime.types';

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

  @Enum({
    items: () => RuntimeType,
    nativeEnumName: 'runtime_instances_type_enum',
  })
  type!: RuntimeType;

  @Property({ type: 'varchar', length: 255 })
  containerName!: string;

  @Enum({
    items: () => RuntimeInstanceStatus,
    default: RuntimeInstanceStatus.Starting,
    nativeEnumName: 'runtime_instances_status_enum',
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

  @Enum({
    items: () => RuntimeStartingPhase,
    nativeEnumName: 'runtime_instances_starting_phase_enum',
    nullable: true,
  })
  startingPhase!: RuntimeStartingPhase | null;

  @Enum({
    items: () => RuntimeErrorCode,
    nativeEnumName: 'runtime_instances_error_code_enum',
    nullable: true,
  })
  errorCode!: RuntimeErrorCode | null;

  @Property({ type: 'text', nullable: true })
  lastError!: string | null;
}
