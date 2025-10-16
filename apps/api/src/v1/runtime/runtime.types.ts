export interface RuntimeStartParams {
  image?: string;
  env?: Record<string, string>;
  workdir?: string;
  labels?: Record<string, string>;
  initScript?: string | string[];
  initScriptTimeoutMs?: number;
  containerName?: string;
}

export interface RuntimeExecParams {
  cmd: string[] | string;
  workdir?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  tailTimeoutMs?: number;
}

export interface RuntimeExecResult {
  fail: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export enum RuntimeType {
  Docker = 'Docker',
}

export interface ProvideRuntimeParams extends RuntimeStartParams {
  autostart?: boolean;
  type: RuntimeType;
}
