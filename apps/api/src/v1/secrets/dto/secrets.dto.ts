import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const SECRET_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

export const CreateSecretSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(
      SECRET_NAME_REGEX,
      'Name must be uppercase snake_case (e.g. API_KEY)',
    ),
  value: z.string().min(1),
  description: z.string().max(1000).nullable().optional(),
});

export const UpdateSecretSchema = z.object({
  value: z.string().min(1).optional(),
  description: z.string().max(1000).nullable().optional(),
});

export const SecretResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  projectId: z.uuid(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const SecretListQuerySchema = z.object({
  projectId: z.uuid().optional(),
});

export class CreateSecretDto extends createZodDto(CreateSecretSchema) {}
export class UpdateSecretDto extends createZodDto(UpdateSecretSchema) {}
export class SecretResponseDto extends createZodDto(SecretResponseSchema) {}
export class SecretListQueryDto extends createZodDto(SecretListQuerySchema) {}

export type CreateSecretData = z.infer<typeof CreateSecretSchema>;
export type UpdateSecretData = z.infer<typeof UpdateSecretSchema>;
export type SecretResponse = z.infer<typeof SecretResponseSchema>;
