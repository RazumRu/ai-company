import { Migration } from '@mikro-orm/migrations';

export class AddFailedRuntimeInstanceStatus1771700000002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TYPE "public"."runtime_instances_status_enum" ADD VALUE IF NOT EXISTS 'Failed'`,
    );
  }

  override async down(): Promise<void> {
    // PostgreSQL does not support removing values from an enum type.
    // No-op: the enum value is harmless if the code no longer references it.
  }
}
