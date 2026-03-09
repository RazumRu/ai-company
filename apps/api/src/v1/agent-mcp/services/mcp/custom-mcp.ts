import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import dedent from 'dedent';

import { IMcpServerConfig } from '../../agent-mcp.types';
import { BaseMcp } from '../base-mcp';

export interface CustomMcpConfig {
  command?: string;
  serverUrl?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

@Injectable({ scope: Scope.TRANSIENT })
export class CustomMcp extends BaseMcp<CustomMcpConfig> {
  constructor(logger: DefaultLogger) {
    super(logger);
  }

  public getMcpConfig(config: CustomMcpConfig): IMcpServerConfig {
    if (config.command) {
      const [command, ...args] = config.command.trim().split(/\s+/) as [string, ...string[]];
      return {
        name: 'custom-mcp',
        command,
        args,
        env: config.env ?? {},
      };
    }

    if (config.serverUrl) {
      const args = ['-y', 'mcp-remote', config.serverUrl, '--transport', 'http-first'];

      if (config.serverUrl.startsWith('http://')) {
        args.push('--allow-http');
      }

      for (const [key, value] of Object.entries(config.headers ?? {})) {
        args.push('--header', `${key}:${value}`);
      }

      return {
        name: 'custom-mcp',
        command: 'npx',
        args,
        env: config.env ?? {},
      };
    }

    throw new Error(
      'Custom MCP requires either a command or a serverUrl',
    );
  }

  public getDetailedInstructions(config: CustomMcpConfig): string {
    const mode = config.command
      ? `Command mode: \`${config.command}\``
      : `URL mode: \`${config.serverUrl ?? '(not set)'}\``;

    return dedent`
      ### Custom MCP Server

      A user-configured MCP server.
      ${mode}

      This MCP server runs inside the connected runtime. Use the available tools as documented by the server.
    `;
  }
}
