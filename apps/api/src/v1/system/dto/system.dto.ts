import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SystemSettingsResponseSchema = z.object({
  githubAppEnabled: z
    .boolean()
    .describe('Whether the GitHub App integration is configured and available'),
});

export type SystemSettingsResponse = z.infer<
  typeof SystemSettingsResponseSchema
>;

export class SystemSettingsResponseDto extends createZodDto(
  SystemSettingsResponseSchema,
) {}
