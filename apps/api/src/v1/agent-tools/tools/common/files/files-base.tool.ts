import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { RuntimeThreadProvider } from '../../../../runtime/services/runtime-thread-provider';
import { shQuote } from '../../../../utils/shell.utils';
import { execRuntimeWithContext } from '../../../agent-tools.utils';
import { BaseTool } from '../../base-tool';

export type FilesBaseToolConfig = {
  runtimeProvider: RuntimeThreadProvider;
};

@Injectable()
export abstract class FilesBaseTool<
  TSchema,
  TConfig extends FilesBaseToolConfig = FilesBaseToolConfig,
  TResult = unknown,
> extends BaseTool<TSchema, TConfig, TResult> {
  /**
   * Default glob patterns excluded from file discovery and search tools.
   * Shared across files_find_paths, files_directory_tree, and files_search_text.
   */
  protected readonly defaultSkipPatterns: readonly string[] = [
    'node_modules/**',
    'dist/**',
    'build/**',
    'coverage/**',
    '.turbo/**',
    '.next/**',
    '.cache/**',
    'out/**',
    '.output/**',
    'tmp/**',
    'temp/**',
  ];

  protected async execCommand(
    params: {
      cmd: string[] | string;
      timeoutMs?: number;
      tailTimeoutMs?: number;
    },
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ) {
    const cmdWrapped =
      typeof params.cmd === 'string'
        ? `( ${params.cmd} )`
        : params.cmd.map((c) => `( ${c} )`);

    try {
      const runtime = await config.runtimeProvider.provide(cfg);

      const res = await execRuntimeWithContext(
        runtime,
        {
          cmd: cmdWrapped,
          timeoutMs: params.timeoutMs ?? 30_000,
          tailTimeoutMs: params.tailTimeoutMs ?? 30_000,
        },
        cfg,
      );

      return {
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        execPath: res.execPath,
      };
    } catch (error) {
      // Handle runtime errors by returning them in the expected RuntimeExecResult format
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        exitCode: 1,
        stdout: '',
        stderr: errorMessage,
        execPath: '',
      };
    }
  }

  /**
   * Atomically write content to a file using a temp file + rename pattern.
   * Shared by files_write_file and files_apply_changes.
   */
  protected async writeFileContent(
    filePath: string,
    content: string,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<{ error?: string }> {
    const contentBase64 = Buffer.from(content, 'utf8').toString('base64');
    const tempFile = `${filePath}.tmp.${Date.now()}.${randomBytes(4).toString('hex')}`;
    const cmd = `printf %s ${shQuote(contentBase64)} | base64 -d > ${shQuote(tempFile)} && mv ${shQuote(tempFile)} ${shQuote(filePath)}`;

    const res = await this.execCommand({ cmd }, config, cfg);
    if (res.exitCode !== 0) {
      return { error: res.stderr || 'Failed to write file' };
    }
    return {};
  }
}
