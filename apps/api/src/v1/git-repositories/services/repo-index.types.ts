import type { RepoIndexEntity } from '../entity/repo-index.entity';
import type { RepoExecFn } from './repo-indexer.service';

export interface GetOrInitIndexParams {
  repositoryId: string;
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
  repoId: string;
  topK: number;
  directoryFilter?: string;
  languageFilter?: string;
}

export interface SearchCodebaseResult {
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  score: number;
}
