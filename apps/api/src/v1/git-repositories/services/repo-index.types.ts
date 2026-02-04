import type { RepoIndexEntity } from '../entity/repo-index.entity';
import type { RepoExecFn } from './repo-indexer.service';

export interface GetOrInitIndexParams {
  repositoryId: string;
  repoUrl: string;
  repoRoot: string;
  execFn: RepoExecFn;
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
