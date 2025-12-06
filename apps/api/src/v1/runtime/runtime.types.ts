import { GraphExecutionMetadata } from '../graphs/graphs.types';

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
  recreate?: boolean;
}

export interface RuntimeExecParams {
  cmd: string[] | string;
  childWorkdir?: string;
  env?: Record<string, string>;
  /**
   * Optional session identifier. When provided, the runtime may keep a persistent
   * shell process keyed by this id and route commands through it instead of
   * starting a fresh process per call.
   */
  sessionId?: string;
  timeoutMs?: number;
  tailTimeoutMs?: number;
  createChildWorkdir?: boolean;
  metadata?: GraphExecutionMetadata;
}

export interface RuntimeExecResult {
  fail: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  execPath: string;
}

export enum RuntimeType {
  Docker = 'Docker',
}

export interface ProvideRuntimeParams extends RuntimeStartParams {
  autostart?: boolean;
  type: RuntimeType;
  recreate?: boolean;
}
