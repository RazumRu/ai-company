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
  registryMirrors?: string[];
  insecureRegistries?: string[];
}

export interface RuntimeExecParams {
  cmd: string[] | string;
  env?: Record<string, string>;
  /**
   * Optional working directory to cd into before executing the command.
   * Can be absolute or relative. If provided, automatically prepends `cd <cwd> && `
   * to the command, eliminating the need for manual cd wrappers in tools.
   */
  cwd?: string;
  /**
   * Optional AbortSignal to cancel an in-flight execution.
   * When aborted, runtimes should best-effort stop the underlying process and
   * return an exit code 124 (timeout/aborted).
   */
  signal?: AbortSignal;
  /**
   * Optional session identifier. When provided, the runtime may keep a persistent
   * shell process keyed by this id and route commands through it instead of
   * starting a fresh process per call.
   */
  sessionId?: string;
  timeoutMs?: number;
  tailTimeoutMs?: number;
  metadata?: GraphExecutionMetadata;
}

export interface RuntimeExecResult {
  fail: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  execPath: string;
  timeout?: number;
}

export enum RuntimeType {
  Docker = 'Docker',
}

export enum RuntimeInstanceStatus {
  Starting = 'Starting',
  Running = 'Running',
  Stopping = 'Stopping',
  Stopped = 'Stopped',
}

export interface ProvideRuntimeInstanceParams {
  graphId: string;
  runtimeNodeId: string;
  threadId: string;
  type: RuntimeType;
  runtimeStartParams: RuntimeStartParams;
  temporary?: boolean;
}
