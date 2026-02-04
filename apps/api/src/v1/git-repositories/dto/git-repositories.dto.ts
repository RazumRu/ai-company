import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { GitRepositoryProvider } from '../git-repositories.types';

export const GitRepositoryProviderSchema = z
  .enum(GitRepositoryProvider)
  .describe('Git repository host provider');

export const GitRepositorySchema = z.object({
  id: z.uuid().describe('Repository ID'),
  owner: z
    .string()
    .describe('Repository owner (GitHub username or organization)'),
  repo: z.string().describe('Repository name'),
  url: z.url().describe('HTTPS URL of the repository'),
  provider: GitRepositoryProviderSchema,
  createdBy: z.uuid().describe('User ID who cloned the repository'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const GetRepositoriesQuerySchema = z.object({
  owner: z.string().optional().describe('Filter by repository owner'),
  repo: z.string().optional().describe('Filter by repository name'),
  provider: GitRepositoryProviderSchema.optional().describe(
    'Filter by host provider',
  ),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(50)
    .describe('Maximum number of repositories to return'),
  offset: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe('Number of repositories to skip'),
});

export const CreateRepositorySchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  url: z.string().url().describe('HTTPS URL of the repository'),
  provider: GitRepositoryProviderSchema.default(GitRepositoryProvider.GITHUB),
  token: z
    .string()
    .optional()
    .describe('GitHub personal access token (encrypted at rest, write-only)'),
});

export const UpdateRepositorySchema = z.object({
  url: z.string().url().describe('HTTPS URL of the repository').optional(),
  token: z
    .string()
    .optional()
    .describe('GitHub personal access token (encrypted at rest, write-only)'),
});

// Type exports
export type GitRepository = z.infer<typeof GitRepositorySchema>;
export type CreateRepository = z.infer<typeof CreateRepositorySchema>;
export type UpdateRepository = z.infer<typeof UpdateRepositorySchema>;

// DTOs
export class GitRepositoryDto extends createZodDto(GitRepositorySchema) {}
export class GetRepositoriesQueryDto extends createZodDto(
  GetRepositoriesQuerySchema,
) {}
export class CreateRepositoryDto extends createZodDto(CreateRepositorySchema) {}
export class UpdateRepositoryDto extends createZodDto(UpdateRepositorySchema) {}
