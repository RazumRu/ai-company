export interface IMcpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}
