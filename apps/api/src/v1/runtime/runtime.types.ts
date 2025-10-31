export interface RuntimeStartParams {
  image?: string;
  env?: Record<string, string>;
  workdir?: string;
  labels?: Record<string, string>;
  initScript?: string | string[];
  initScriptTimeoutMs?: number;
  containerName?: string;
  network?: string;
  enableDind?: boolean;
}

export interface RuntimeExecParams {
  cmd: string[] | string;
  childWorkdir?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  tailTimeoutMs?: number;
  createChildWorkdir?: boolean;
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
  recreate?: boolean;
}
