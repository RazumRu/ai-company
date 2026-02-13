import {
  isAbsolute,
  join as joinPath,
  posix as posixPath,
  relative,
  resolve,
} from 'node:path';

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
    .optional()
    .describe(
      `Absolute path to the git repository root (the directory containing the .git folder). ` +
        `Use the exact path returned by gh_clone. If omitted, the tool will auto-detect ` +
        `the repository under ${BASE_RUNTIME_WORKDIR}.`,
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
  total_lines?: number;
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
    'MANDATORY FIRST STEP for any codebase exploration. Perform semantic search across a git repository to find relevant code by meaning. Use natural-language queries (not single keywords) for best results. Returns file paths, line ranges, total_lines (file size), and code snippets ranked by relevance. ALWAYS use this tool immediately after gh_clone — do NOT start with files_directory_tree or files_find_paths. Check total_lines in results: read small files (≤300 lines) entirely, but for large files (>300 lines) ALWAYS use fromLineNumber/toLineNumber in files_read. The repository must be cloned first with gh_clone.';

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
      ### ⚠️ MANDATORY FIRST STEP
      This tool MUST be your very first action after cloning a repository. Do NOT use \`files_directory_tree\` or \`files_find_paths\` before \`codebase_search\`. Those tools produce noisy, unfocused output. \`codebase_search\` returns exactly the code you need with precise file paths and line numbers.

      ### Overview
      Semantic codebase search that indexes a git repository on demand.
      Indexing is triggered automatically on the first call. For large repositories
      indexing runs in the background — in that case the tool will indicate that
      indexing is in progress and you should retry shortly.

      ### Prerequisites
      - Repository MUST be cloned first. Use \`gh_clone\` if not already done.
      - \`gitRepoDirectory\` is optional — if omitted, the tool auto-detects the first git repo under ${BASE_RUNTIME_WORKDIR}.
      - When provided, use the exact path returned by gh_clone. It must point to the repository root (containing .git folder).

      ### When to Use
      - ALWAYS your first action after \`gh_clone\` — no exceptions
      - Any codebase discovery or "where is X?" question
      - Understanding architecture, finding implementations, locating definitions
      - Use multiple queries to explore different aspects (e.g., "authentication middleware", "database models", "API routes")

      ### When NOT to Use
      - You already have the file paths and line numbers you need from a previous search

      ### Requirements
      - Must be inside a git repository
      - Query must be a human-readable phrase or question (not a single word)

      ### Output Fields
      Each result contains:
      - \`path\` — absolute file path (use directly with \`files_read\`, no need to verify)
      - \`start_line\` / \`end_line\` — line range of the matched chunk
      - \`total_lines\` — total number of lines in the file (**ALWAYS check this before reading**)
      - \`text\` — code snippet
      - \`score\` — relevance score (0-1)

      ### ⚠️ CRITICAL — Reading Strategy Based on total_lines
      You MUST check \`total_lines\` before calling \`files_read\`:
      - **Small files (≤300 lines)**: read the entire file with \`files_read\`
      - **Large files (>300 lines)**: you MUST use \`fromLineNumber\`/\`toLineNumber\` in \`files_read\`. Set the range to \`start_line - 30\` through \`end_line + 30\` from the search result. NEVER fetch the full content of files with more than 300 lines.

      ### Recommended Flow
      1) Clone repo with \`gh_clone\` (if not already cloned).
      2) Run \`codebase_search\` with semantic queries — this is ALWAYS your first exploration step.
      3) Check \`total_lines\` in results. For small files (≤300), read entirely. For large files (>300), use line ranges from \`start_line\`/\`end_line\`.
      4) Use additional \`codebase_search\` queries to explore other aspects of the codebase.
      5) Use \`files_search_text\` for exact pattern matching (function names, variable references).

      ### Examples
      \`\`\`json
      {"query":"where is auth middleware created?","top_k":5,"gitRepoDirectory":"${BASE_RUNTIME_WORKDIR}/project","language":"ts"}
      \`\`\`
      When there is only one repo in the workspace, gitRepoDirectory can be omitted:
      \`\`\`json
      {"query":"where is auth middleware created?","top_k":5}
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
    const title = this.generateTitle(args, config);
    const messageMetadata = { __title: title };

    const normalizedQuery = args.query.trim();
    if (!normalizedQuery) {
      return {
        output: { error: 'query must not be blank' },
        messageMetadata,
      };
    }

    // Auto-discover git repo when gitRepoDirectory is not provided.
    const gitRepoDirectory =
      args.gitRepoDirectory ?? (await this.autoDiscoverRepo(config, cfg));

    if (!gitRepoDirectory) {
      return {
        output: {
          error: dedent`
            codebase_search requires a cloned git repository but none was found under ${BASE_RUNTIME_WORKDIR}.

            REQUIRED ACTION: Clone the repository first using gh_clone, then retry with the returned path.

            Example workflow:
            1. gh_clone({"owner": "owner", "repo": "repo-name"}) -> returns {"path": "${BASE_RUNTIME_WORKDIR}/repo-name"}
            2. codebase_search({"query": "your query", "gitRepoDirectory": "${BASE_RUNTIME_WORKDIR}/repo-name"})
          `,
        },
        messageMetadata,
      };
    }

    const repoRoot = await this.resolveRepoRoot(config, cfg, gitRepoDirectory);
    if (!repoRoot) {
      return {
        output: {
          error: dedent`
            codebase_search requires a cloned git repository.

            No git repository found at: ${gitRepoDirectory}

            REQUIRED ACTION: Clone the repository first using gh_clone, then retry with the returned path.

            Example workflow:
            1. gh_clone({"owner": "owner", "repo": "repo-name"}) -> returns {"path": "${BASE_RUNTIME_WORKDIR}/repo-name"}
            2. codebase_search({"query": "your query", "gitRepoDirectory": "${BASE_RUNTIME_WORKDIR}/repo-name"})
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

    if (indexResult.status !== 'ready') {
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
      gitRepoDirectory,
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

  /**
   * Auto-detect the git repository under /runtime-workspace when the caller
   * does not provide gitRepoDirectory. Lists top-level directories and returns
   * the first one that contains a .git folder.
   */
  private async autoDiscoverRepo(
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<string | null> {
    // List immediate children of the workspace that are git repos.
    const res = await this.execCommand(
      {
        cmd: `find ${shQuote(BASE_RUNTIME_WORKDIR)} -maxdepth 2 -name .git -type d 2>/dev/null | head -1`,
      },
      config,
      cfg,
    );
    if (res.exitCode !== 0) return null;
    const gitDir = res.stdout.trim();
    if (!gitDir) return null;
    // .git dir found — return the parent (repo root)
    const repoRoot = gitDir.replace(/\/\.git$/, '');
    return repoRoot.length ? repoRoot : null;
  }

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
      return posixPath
        .normalize(relativeToRepo.replace(/\\/g, '/'))
        .replace(/^\/+/, '');
    }
    return posixPath.normalize(trimmed.replace(/\\/g, '/')).replace(/^\/+/, '');
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

    // 3. Last resort — try common default branch names before giving up
    const defaultBranchRes = await execFn({
      cmd: `git -C ${shQuote(repoRoot)} branch --list main master`,
    });
    if (defaultBranchRes.exitCode === 0) {
      const branches = defaultBranchRes.stdout
        .split('\n')
        .map((b) => b.replace(/^\*?\s+/, '').trim())
        .filter(Boolean);
      if (branches.includes('main')) return 'main';
      if (branches.includes('master')) return 'master';
    }

    return 'main';
  }
}
