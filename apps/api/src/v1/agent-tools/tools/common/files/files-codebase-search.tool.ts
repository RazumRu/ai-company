import { isAbsolute, join as joinPath, relative, resolve } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';

import { environment } from '../../../../../environments';
import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { RepoIndexService } from '../../../../git-repositories/services/repo-index.service';
import type { GetOrInitIndexResult } from '../../../../git-repositories/services/repo-index.types';
import { RepoExecFn } from '../../../../git-repositories/services/repo-indexer.service';
import { BASE_RUNTIME_WORKDIR } from '../../../../runtime/services/base-runtime';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 15;

const CodebaseSearchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Query to search for in the codebase. Use a human-readable phrase or question, not a single word.',
    ),
  top_k: z
    .number()
    .int()
    .min(1)
    .max(MAX_TOP_K)
    .optional()
    .describe('Maximum number of results to return.'),
  directory: z
    .string()
    .min(1)
    .describe('Absolute path to the cloned repository directory.'),
  language: z
    .string()
    .min(1)
    .optional()
    .describe('Optional language filter (e.g. ts, py, go).'),
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

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class FilesCodebaseSearchTool extends FilesBaseTool<CodebaseSearchSchemaType> {
  public name = 'codebase_search';
  public description =
    'Semantic search across a git repo codebase using Qdrant.';

  constructor(private readonly repoIndexService: RepoIndexService) {
    super();
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Semantic codebase search that indexes a git repository into Qdrant on demand.
      Indexing is triggered automatically on the first call. For large repositories
      indexing runs in the background — in that case the tool will indicate that
      indexing is in progress and you should retry shortly.

      ### When to Use
      - FIRST STEP for any codebase discovery or "where is X?" question
      - Large repos where reading many files is slow
      - Locating relevant code chunks by description

      ### Requirements
      - Must be inside a git repository
      - \`directory\` is required (absolute path to the repo)
      - Query must be a human-readable phrase or question (not a single word)

      ### Recommended Flow
      1) Run \`codebase_search\` with a semantic query.
      2) Read top results with \`files_read\`.
      3) Use \`files_search_text\` for exact usages or strings.

      ### Example
      \`\`\`json
      {"query":"where is auth middleware created?","top_k":5,"directory":"apps/api/src","language":"ts"}
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

    const repoRoot = await this.resolveRepoRoot(config, cfg, args.directory);
    if (!repoRoot) {
      return {
        output: {
          error:
            'codebase_search requires a cloned git repository (no git work tree detected).',
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

    const indexResult = await this.repoIndexService.getOrInitIndexForRepo({
      repositoryId,
      repoUrl: repoInfo.repoId,
      repoRoot,
      execFn,
    });

    if (indexResult.status !== 'ready' || !indexResult.repoIndex) {
      return {
        output: {
          error: 'Repository indexing is in progress. Please retry shortly.',
        },
        messageMetadata,
      };
    }

    const collection = indexResult.repoIndex.qdrantCollection;
    const directoryFilter = this.normalizeDirectoryFilter(
      args.directory,
      repoRoot,
    );

    const results = await this.repoIndexService.searchCodebase({
      collection,
      query: normalizedQuery,
      repoId: repoInfo.repoId,
      topK: args.top_k ?? DEFAULT_TOP_K,
      directoryFilter,
      languageFilter: args.language,
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
      ? this.normalizeRepoId(remoteUrl)
      : `local:${repoRoot}`;
    return { repoId };
  }

  private normalizeRepoId(url: string): string {
    let normalized = url.trim();
    if (normalized.startsWith('git@') && normalized.includes(':')) {
      const [host, pathPart] = normalized.replace('git@', '').split(':');
      normalized = `https://${host}/${pathPart}`;
    }
    normalized = normalized.replace(/^ssh:\/\//, 'https://');
    normalized = normalized.replace(/\.git$/i, '');
    return normalized.replace(/\/+$/, '');
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
}
