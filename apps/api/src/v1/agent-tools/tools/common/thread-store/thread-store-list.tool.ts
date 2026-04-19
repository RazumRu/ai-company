import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/agents.types';
import { THREAD_STORE_MAX_NAMESPACE_LENGTH } from '../../../../thread-store/thread-store.types';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import {
  ThreadStoreBaseTool,
  ThreadStoreBaseToolConfig,
} from './thread-store-base.tool';

export const ThreadStoreListToolSchema = z.object({
  namespace: z
    .string()
    .min(1)
    .max(THREAD_STORE_MAX_NAMESPACE_LENGTH)
    .optional()
    .describe(
      'When provided, list all entries in this namespace (newest first). ' +
        'When omitted, return a summary of all namespaces with their entry counts.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Max number of entries to return when namespace is provided. Defaults to 50.',
    ),
});
export type ThreadStoreListToolSchemaType = z.infer<
  typeof ThreadStoreListToolSchema
>;

export interface ThreadStoreListEntry {
  namespace: string;
  key: string;
  value: unknown;
  mode: 'kv' | 'append';
  authorAgentId: string | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadStoreListSummary {
  namespace: string;
  entryCount: number;
  lastUpdatedAt: string;
}

export interface ThreadStoreListToolOutput {
  namespaces?: ThreadStoreListSummary[];
  entries?: ThreadStoreListEntry[];
}

@Injectable()
export class ThreadStoreListTool extends ThreadStoreBaseTool<
  ThreadStoreListToolSchemaType,
  ThreadStoreListToolOutput
> {
  public name = 'thread_store_list';
  public description =
    "Discover what is in the current thread's shared store. " +
    'Without a namespace, returns a summary of every namespace with entry counts. ' +
    'With a namespace, returns the entries (newest first, capped by limit). ' +
    'Prefer thread_store_get when you already know the exact key -- listing everything wastes context.';

  public get schema() {
    return ThreadStoreListToolSchema;
  }

  protected override generateTitle(
    args: ThreadStoreListToolSchemaType,
  ): string {
    return args.namespace ? `Store list: ${args.namespace}` : 'Store list';
  }

  public getDetailedInstructions(
    _config: ThreadStoreBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Two modes:
      - **Summary mode (no namespace)**: returns \`namespaces: [{namespace, entryCount, lastUpdatedAt}, ...]\`.
        Use this as a cheap first call to see what's available.
      - **Entries mode (namespace provided)**: returns \`entries: [...]\` sorted by createdAt DESC.

      ### Efficiency Rules
      - Do NOT list entries at the top of every turn — you'll blow up your context window.
      - Start with summary mode; only list a specific namespace when you actually need its contents.
      - If you know the key, call thread_store_get instead.

      ### Examples
      Summary: \`{}\`
      Entries: \`{"namespace": "learnings", "limit": 20}\`
    `;
  }

  public async invoke(
    args: ThreadStoreListToolSchemaType,
    _config: ThreadStoreBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<ThreadStoreListToolOutput>> {
    const { userId, internalThreadId } = await this.resolveContext(cfg);

    if (!args.namespace) {
      const namespaces = await this.threadStoreService.listNamespacesForUser(
        userId,
        internalThreadId,
      );
      return { output: { namespaces } };
    }

    const entries = await this.threadStoreService.listEntriesForUser(
      userId,
      internalThreadId,
      args.namespace,
      { limit: args.limit ?? 50, offset: 0 },
    );

    return {
      output: {
        entries: entries.map((entry) => ({
          namespace: entry.namespace,
          key: entry.key,
          value: entry.value,
          mode: entry.mode,
          authorAgentId: entry.authorAgentId,
          tags: entry.tags,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })),
      },
    };
  }
}
