import { TimestampsEntity } from '@packages/typeorm';
import {
  Column,
  Entity,
  Generated,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

const vectorTransformer = {
  to: (value?: number[] | null) =>
    value && value.length > 0 ? `[${value.join(',')}]` : null,
  from: (value?: string | null): number[] | null => {
    if (!value) return null;
    const trimmed = value.replace(/^\[|\]$/g, '').trim();
    if (!trimmed) return [];
    return trimmed
      .split(',')
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
  },
};

@Entity('knowledge_chunks')
@Index(['docId', 'chunkIndex'], { unique: true })
export class KnowledgeChunkEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  @Generated('increment')
  @Index({ unique: true })
  publicId!: number;

  @Column({ type: 'uuid' })
  @Index()
  docId!: string;

  @Column({ type: 'int' })
  chunkIndex!: number;

  @Column({ type: 'varchar', nullable: true })
  label?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  keywords?: string[] | null;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'int' })
  startOffset!: number;

  @Column({ type: 'int' })
  endOffset!: number;

  @Column({ type: 'vector', nullable: true, transformer: vectorTransformer })
  embedding?: number[] | null;
}
