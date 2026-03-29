import type { EntityManager } from '@mikro-orm/postgresql';
import { Seeder } from '@mikro-orm/seeder';

export class LocalDevelopmentSeeder extends Seeder {
  override async run(em: EntityManager): Promise<void> {
    // Add seed data here using em.create() and em.flush()
  }
}
