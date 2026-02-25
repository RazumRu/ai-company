import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFailedRuntimeInstanceStatus1771700000002
  implements MigrationInterface
{
  name = 'AddFailedRuntimeInstanceStatus1771700000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."runtime_instances_status_enum" ADD VALUE IF NOT EXISTS 'Failed'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from an enum type.
    // No-op: the enum value is harmless if the code no longer references it.
  }
}
