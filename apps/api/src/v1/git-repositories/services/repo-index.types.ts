import type { RepoIndexEntity } from '../entity/repo-index.entity';
import type { RepoExecFn } from './repo-indexer.service';

export interface GetOrInitIndexParams {
  /** Database UUID of the git_repository row (NOT the normalized URL). */
  repositoryId: string;
  /**
   * Normalized remote URL (e.g. `https://github.com/owner/repo`) produced by
   * `RepoIndexerService.deriveRepoId()`. Stored in Qdrant as the `repo_id`
   * payload field and in the `repo_index.repo_url` DB column.
   */
  repoUrl: string;
  repoRoot: string;
  execFn: RepoExecFn;
  /** Git branch currently checked out. Used to scope the index per branch and for background clone. */
  branch: string;
  /** User ID of the agent owner. Used to scope repository resolution to the correct user. */
  userId?: string;
}

export interface GetOrInitIndexResult {
  status: 'ready' | 'in_progress' | 'pending';
  repoIndex: RepoIndexEntity | null;
}

export interface SearchCodebaseParams {
  collection: string;
  query: string;
  /**
   * Normalized remote URL used as the `repo_id` filter in Qdrant
   * (produced by `RepoIndexerService.deriveRepoId()`).
   */
  repoId: string;
  topK: number;
  directoryFilter?: string;
  languageFilter?: string;
  /** Minimum cosine similarity score (0-1). Results below this threshold are discarded. */
  minScore?: number;
}

export interface SearchCodebaseResult {
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  score: number;
}
