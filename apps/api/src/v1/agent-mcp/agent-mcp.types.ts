/**
 * MCP server status enum
 */
export enum McpStatus {
  IDLE = 'idle',
  INITIALIZING = 'initializing',
  READY = 'ready',
  DESTROYED = 'destroyed',
}

export interface IMcpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  requiresDockerDaemon?: boolean;
}
