import { Migration } from '@mikro-orm/migrations';

export class AddDaytonaRuntimeType1771700000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TYPE "public"."runtime_instances_type_enum" ADD VALUE IF NOT EXISTS 'Daytona'`,
    );
  }

  override async down(): Promise<void> {
    // PostgreSQL does not support removing values from an enum type.
    // No-op: the enum value is harmless if the code no longer references it.
  }
}
