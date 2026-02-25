import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDaytonaRuntimeType1771700000000 implements MigrationInterface {
  name = 'AddDaytonaRuntimeType1771700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."runtime_instances_type_enum" ADD VALUE IF NOT EXISTS 'Daytona'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from an enum type.
    // No-op: the enum value is harmless if the code no longer references it.
  }
}
