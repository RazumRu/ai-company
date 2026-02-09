import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  GitRepositoryProvider,
  RepoIndexStatus,
} from '../git-repositories.types';

export const GitRepositoryProviderSchema = z
  .nativeEnum(GitRepositoryProvider)
  .describe('Git repository host provider');

export const GitRepositorySchema = z.object({
  id: z.uuid().describe('Repository ID'),
  owner: z
    .string()
    .describe('Repository owner (GitHub username or organization)'),
  repo: z.string().describe('Repository name'),
  url: z.url().describe('HTTPS URL of the repository'),
  provider: GitRepositoryProviderSchema,
  defaultBranch: z
    .string()
    .describe('Default branch of the repository (e.g. main, master)'),
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
  defaultBranch: z
    .string()
    .optional()
    .default('main')
    .describe('Default branch of the repository (defaults to main)'),
  token: z
    .string()
    .optional()
    .describe('GitHub personal access token (encrypted at rest, write-only)'),
});

export const UpdateRepositorySchema = z.object({
  url: z.string().url().describe('HTTPS URL of the repository').optional(),
  defaultBranch: z
    .string()
    .optional()
    .describe('Default branch of the repository'),
  token: z
    .string()
    .optional()
    .describe('GitHub personal access token (encrypted at rest, write-only)'),
});

// Repo index schemas
export const RepoIndexStatusSchema = z.nativeEnum(RepoIndexStatus);

export const RepoIndexSchema = z.object({
  id: z.uuid().describe('Index ID'),
  repositoryId: z.uuid().describe('Repository ID'),
  repoUrl: z.string().describe('Repository URL'),
  branch: z.string().describe('Git branch name this index covers'),
  status: RepoIndexStatusSchema.describe('Indexing status'),
  qdrantCollection: z.string().describe('Qdrant collection name'),
  lastIndexedCommit: z.string().nullable().describe('Last indexed commit hash'),
  embeddingModel: z.string().nullable().describe('Embedding model used'),
  vectorSize: z.number().int().nullable().describe('Vector dimension size'),
  chunkingSignatureHash: z
    .string()
    .nullable()
    .describe('Chunking configuration hash'),
  estimatedTokens: z.number().int().describe('Estimated token count'),
  indexedTokens: z.number().int().describe('Actual indexed tokens'),
  errorMessage: z.string().nullable().describe('Error message if failed'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const GetRepoIndexesQuerySchema = z.object({
  repositoryId: z.uuid().optional().describe('Filter by repository ID'),
  branch: z.string().optional().describe('Filter by single branch name'),
  branches: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : Array.isArray(v) ? v : [v],
    )
    .describe(
      'Filter by multiple branch names (comma-separated or repeated query param)',
    ),
  status: RepoIndexStatusSchema.optional().describe('Filter by status'),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(50)
    .describe('Maximum number of indexes to return'),
  offset: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe('Number of indexes to skip'),
});

export const TriggerReindexSchema = z.object({
  repositoryId: z.uuid().describe('Repository ID to reindex'),
  branch: z
    .string()
    .optional()
    .describe(
      'Branch to reindex. Defaults to the repository default branch (main).',
    ),
});

export const TriggerReindexResponseSchema = z.object({
  repoIndex: RepoIndexSchema,
  message: z.string().describe('Human-readable status message'),
});

// Type exports
export type GitRepository = z.infer<typeof GitRepositorySchema>;
export type CreateRepository = z.infer<typeof CreateRepositorySchema>;
export type UpdateRepository = z.infer<typeof UpdateRepositorySchema>;
export type RepoIndex = z.infer<typeof RepoIndexSchema>;
export type TriggerReindex = z.infer<typeof TriggerReindexSchema>;
export type TriggerReindexResponse = z.infer<
  typeof TriggerReindexResponseSchema
>;

// DTOs
export class GitRepositoryDto extends createZodDto(GitRepositorySchema) {}
export class GetRepositoriesQueryDto extends createZodDto(
  GetRepositoriesQuerySchema,
) {}
export class CreateRepositoryDto extends createZodDto(CreateRepositorySchema) {}
export class UpdateRepositoryDto extends createZodDto(UpdateRepositorySchema) {}
export class RepoIndexDto extends createZodDto(RepoIndexSchema) {}
export class GetRepoIndexesQueryDto extends createZodDto(
  GetRepoIndexesQuerySchema,
) {}
export class TriggerReindexDto extends createZodDto(TriggerReindexSchema) {}
export class TriggerReindexResponseDto extends createZodDto(
  TriggerReindexResponseSchema,
) {}
