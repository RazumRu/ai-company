export interface RuntimeStartParams {
  image?: string;
  env?: Record<string, string>;
  workdir?: string;
}

export interface RuntimeExecParams {
  cmd: string[] | string;
  workdir?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
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
