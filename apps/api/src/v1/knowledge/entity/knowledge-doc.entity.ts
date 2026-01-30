import { TimestampsEntity } from '@packages/typeorm';
import {
  Column,
  Entity,
  Generated,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('knowledge_docs')
export class KnowledgeDocEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  @Generated('increment')
  @Index({ unique: true })
  publicId!: number;

  @Column({ type: 'uuid' })
  @Index()
  createdBy!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  summary?: string | null;

  @Column({ type: 'text', nullable: true })
  politic?: string | null;

  @Column({ type: 'text', nullable: true })
  embeddingModel?: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  tags!: string[];
}
