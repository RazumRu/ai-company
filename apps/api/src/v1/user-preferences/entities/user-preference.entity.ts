import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { UserPreferencesPayload } from '../user-preferences.types';

@Entity('user_preference')
export class UserPreferenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  @Index({ unique: true })
  userId!: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  preferences!: UserPreferencesPayload;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
