import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

import type { UserPreferencesPayload } from '../user-preferences.types';

@Entity({ tableName: 'user_preference' })
export class UserPreferenceEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'varchar' })
  @Unique()
  userId!: string;

  @Property({ type: 'jsonb', default: '{}' })
  preferences!: UserPreferencesPayload;

  @Property({ type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date();

  @Property({
    type: 'timestamptz',
    defaultRaw: 'now()',
    onUpdate: () => new Date(),
  })
  updatedAt: Date = new Date();
}
