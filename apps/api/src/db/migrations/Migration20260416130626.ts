// Runtime enum CHECK drift removed — see reference_geniro_runtime_schema.md. Known cosmetic issue.
import { Migration } from '@mikro-orm/migrations';

export class Migration20260416130626 extends Migration {
  override up(): void | Promise<void> {
    this.addSql(
      `alter table "graphs" add "settings" jsonb not null default '{}';`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "graphs" drop column "settings";`);
  }
}
