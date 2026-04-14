import { Migration } from '@mikro-orm/migrations';

export class Migration20260414095208 extends Migration {
  override up(): void | Promise<void> {
    this.addSql(
      `alter table "runtime_instances" drop constraint "runtime_instances_type_check";`,
    );
    this.addSql(
      `alter table "runtime_instances" add constraint "runtime_instances_type_check" check ("type" in ('Docker', 'Daytona', 'K8s'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "runtime_instances" drop constraint "runtime_instances_type_check";`,
    );
    this.addSql(
      `alter table "runtime_instances" add constraint "runtime_instances_type_check" check ("type" in ('Docker', 'Daytona'));`,
    );
  }
}
