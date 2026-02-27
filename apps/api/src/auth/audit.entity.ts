import { TimestampsEntity } from '@packages/typeorm';
import { Column, Index } from 'typeorm';

export class AuditEntity extends TimestampsEntity {
  @Column({ type: 'varchar' })
  @Index()
  createdBy!: string;

  @Column({ type: 'uuid' })
  @Index()
  projectId!: string;
}
