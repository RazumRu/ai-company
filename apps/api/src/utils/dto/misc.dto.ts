import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const EntityUUIDSchema = z
  .object({
    id: z.uuid(),
  })
  .strip();

export class EntityUUIDDto extends createZodDto(EntityUUIDSchema) {}
