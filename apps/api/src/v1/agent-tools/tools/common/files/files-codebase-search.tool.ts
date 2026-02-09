import { isAbsolute, join as joinPath, relative, resolve } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';

import { environment } from '../../../../../environments';
import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { RepoIndexService } from '../../../../git-repositories/services/repo-index.service';
import {
  RepoExecFn,
  RepoIndexerService,
} from '../../../../git-repositories/services/repo-indexer.service';
import { BASE_RUNTIME_WORKDIR } from '../../../../runtime/services/base-runtime';
import { shQuote } from '../../../../utils/shell.utils';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

const DEFAULT_TOP_K = 15;
const MAX_TOP_K = 30;
const DEFAULT_MIN_SCORE = 0.3;

const CodebaseSearchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'A natural-language phrase or question describing what you are looking for (e.g., "where is the authentication middleware defined?"). Do not use single keywords — multi-word semantic queries produce much better results.',
    ),
  top_k: z
    .number()
    .int()
    .min(1)
    .max(MAX_TOP_K)
    .optional()
    .describe(
      'Maximum number of code chunk results to return (default: 15, max: 30). Start with 5-10 for focused queries.',
    ),
  gitRepoDirectory: z
    .string()
    .min(1)
    .describe(
      'Absolute path to the git repository root (the directory containing the .git folder). Use the exact path returned by gh_clone.',
    ),
  language: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Filter results to a specific programming language by file extension (e.g., "ts", "py", "go", "rs"). Omit to search all languages.',
    ),
});

type CodebaseSearchSchemaType = z.infer<typeof CodebaseSearchSchema>;

type CodebaseSearchResult = {
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  score: number;
};

type CodebaseSearchOutput = {
  error?: string;
  results?: CodebaseSearchResult[];
};

@Injectable()
export class FilesCodebaseSearchTool extends FilesBaseTool<CodebaseSearchSchemaType> {
  public name = 'codebase_search';
  public description =
    'Perform semantic search across a git repository to find relevant code by meaning. Use natural-language queries (not single keywords) for best results. Returns file paths, line ranges, and code snippets ranked by relevance. This should be the first tool for codebase discovery or "where is X?" questions. The repository must be cloned first with gh_clone.';

  constructor(
    private readonly repoIndexService: RepoIndexService,
    private readonly repoIndexerService: RepoIndexerService,
  ) {
    super();
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Semantic codebase search that indexes a git repository on demand.
      Indexing is triggered automatically on the first call. For large repositories
      indexing runs in the background — in that case the tool will indicate that
      indexing is in progress and you should retry shortly.

      ### Prerequisites
      - Repository MUST be cloned first. Use \`gh_clone\` if not already done.
      - Use the exact path returned by gh_clone for gitRepoDirectory.
      - \`gitRepoDirectory\` must point to the repository root (containing .git folder).

      ### When to Use
      - FIRST STEP for any codebase discovery or "where is X?" question
      - Large repos where reading many files is slow
      - Locating relevant code chunks by description

      ### Requirements
      - Must be inside a git repository
      - Query must be a human-readable phrase or question (not a single word)

      ### Recommended Flow
      1) Clone repo with \`gh_clone\` (if not already cloned).
      2) Run \`codebase_search\` with a semantic query using the cloned path.
      3) Read top results with \`files_read\` using the \`path\` field directly — do NOT call files_find_paths first.
      4) Use \`files_search_text\` for exact usages or strings.

      ### Example
      \`\`\`json
      {"query":"where is auth middleware created?","top_k":5,"gitRepoDirectory":"/runtime-workspace/project","language":"ts"}
      \`\`\`
    `;
  }

  public get schema() {
    return CodebaseSearchSchema;
  }

  protected override generateTitle(
    args: CodebaseSearchSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    return `Codebase search: ${args.query}`;
  }

  public async invoke(
    args: CodebaseSearchSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<CodebaseSearchOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const normalizedQuery = args.query.trim();
    if (!normalizedQuery) {
      return {
        output: { error: 'query is required' },
        messageMetadata,
      };
    }

    const repoRoot = await this.resolveRepoRoot(
      config,
      cfg,
      args.gitRepoDirectory,
    );
    if (!repoRoot) {
      return {
        output: {
          error: dedent`
            codebase_search requires a cloned git repository.

            No git repository found at: ${args.gitRepoDirectory}

            REQUIRED ACTION: Clone the repository first using gh_clone, then retry with the returned path.

            Example workflow:
            1. gh_clone({"owner": "owner", "repo": "repo-name"}) -> returns {"path": "/runtime-workspace/repo-name"}
            2. codebase_search({"query": "your query", "gitRepoDirectory": "/runtime-workspace/repo-name"})
          `,
        },
        messageMetadata,
      };
    }

    const repoInfo = await this.resolveRepoInfo(repoRoot, config, cfg);
    if ('error' in repoInfo) {
      return { output: { error: repoInfo.error }, messageMetadata };
    }

    const repositoryId = uuidv5(
      repoInfo.repoId,
      environment.codebaseUuidNamespace,
    );

    const execFn: RepoExecFn = async (params) => {
      const res = await this.execCommand({ cmd: params.cmd }, config, cfg);
      return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
    };

    // Resolve the checked-out branch (or fall back to remote default for detached HEAD)
    const branch = await this.resolveCurrentBranch(repoRoot, execFn);

    const userId = cfg.configurable?.graph_created_by as string | undefined;

    const indexResult = await this.repoIndexService.getOrInitIndexForRepo({
      repositoryId,
      repoUrl: repoInfo.repoId,
      repoRoot,
      execFn,
      branch,
      userId,
    });

    if (indexResult.status !== 'ready' || !indexResult.repoIndex) {
      return {
        output: {
          results: [],
          error:
            'Repository indexing is currently in progress. This is normal for the first search in a repository.',
        },
        messageMetadata,
      };
    }

    const collection = indexResult.repoIndex.qdrantCollection;
    const directoryFilter = this.normalizeDirectoryFilter(
      args.gitRepoDirectory,
      repoRoot,
    );

    const results = await this.repoIndexService.searchCodebase({
      collection,
      query: normalizedQuery,
      repoId: indexResult.repoIndex.repoUrl,
      topK: args.top_k ?? DEFAULT_TOP_K,
      directoryFilter,
      languageFilter: args.language,
      minScore: DEFAULT_MIN_SCORE,
    });

    return {
      output: { results },
      messageMetadata,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: repo discovery
  // ---------------------------------------------------------------------------

  private async resolveRepoRoot(
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
    directory: string,
  ): Promise<string | null> {
    const trimmed = directory.trim();
    const absoluteDir = trimmed.startsWith(BASE_RUNTIME_WORKDIR)
      ? trimmed
      : joinPath(BASE_RUNTIME_WORKDIR, trimmed.replace(/^\/+/, ''));
    const res = await this.execCommand(
      { cmd: `git -C ${shQuote(absoluteDir)} rev-parse --show-toplevel` },
      config,
      cfg,
    );
    if (res.exitCode !== 0) {
      return null;
    }
    const root = res.stdout.trim();
    return root.length ? root : null;
  }

  private async resolveRepoInfo(
    repoRoot: string,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<{ repoId: string } | { error: string }> {
    const remoteRes = await this.execCommand(
      { cmd: `git -C ${shQuote(repoRoot)} remote get-url origin` },
      config,
      cfg,
    );
    const remoteUrl = remoteRes.exitCode === 0 ? remoteRes.stdout.trim() : '';
    const repoId = remoteUrl
      ? this.repoIndexerService.deriveRepoId(remoteUrl)
      : `local:${repoRoot}`;
    return { repoId };
  }

  // ---------------------------------------------------------------------------
  // Private: path normalization
  // ---------------------------------------------------------------------------

  private normalizeDirectoryFilter(
    directory: string | undefined,
    repoRoot: string,
  ): string | undefined {
    const trimmed = directory?.trim();
    if (!trimmed) return undefined;
    const resolved = isAbsolute(trimmed)
      ? resolve(trimmed)
      : resolve(repoRoot, trimmed);
    const relativeToRepo = relative(repoRoot, resolved);
    if (!relativeToRepo || relativeToRepo === '.') {
      return '';
    }
    if (!relativeToRepo.startsWith('..') && !isAbsolute(relativeToRepo)) {
      return this.normalizePath(relativeToRepo);
    }
    return this.normalizePath(trimmed);
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  }

  /**
   * Resolve the branch currently checked out in the repo.
   * For detached HEAD, resolves the remote default branch to avoid
   * creating an orphaned index per commit SHA.
   */
  private async resolveCurrentBranch(
    repoRoot: string,
    execFn: RepoExecFn,
  ): Promise<string> {
    // 1. Try the local branch name (works for normal checkouts)
    const branchRes = await execFn({
      cmd: `git -C ${shQuote(repoRoot)} symbolic-ref --short HEAD`,
    });
    if (branchRes.exitCode === 0) {
      const branch = branchRes.stdout.trim();
      if (branch.length) {
        return branch;
      }
    }

    // 2. Detached HEAD — resolve the remote's default branch so we reuse
    //    an existing index instead of creating a per-commit-SHA orphan.
    const remoteHeadRes = await execFn({
      cmd: `git -C ${shQuote(repoRoot)} symbolic-ref refs/remotes/origin/HEAD`,
    });
    if (remoteHeadRes.exitCode === 0) {
      const ref = remoteHeadRes.stdout.trim();
      const defaultBranch = ref.replace('refs/remotes/origin/', '');
      if (defaultBranch.length) {
        return defaultBranch;
      }
    }

    // 3. Last resort — fall back to 'main' to avoid orphaned per-SHA indexes
    return 'main';
  }
}
