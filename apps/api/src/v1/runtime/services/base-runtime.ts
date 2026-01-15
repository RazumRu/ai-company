import { Duplex, PassThrough } from 'node:stream';

import { EventEmitter } from 'events';
import { isArray } from 'lodash';

import { GraphExecutionMetadata } from '../../graphs/graphs.types';
import {
  RuntimeExecParams,
  RuntimeExecResult,
  RuntimeStartParams,
} from '../runtime.types';

export type RuntimeExecStartEvent = {
  execId: string;
  params: RuntimeExecParams;
};

export type RuntimeExecEndEvent = {
  execId: string;
  params: RuntimeExecParams;
  result?: RuntimeExecResult;
  error?: unknown;
};

export type RuntimeStartEvent = {
  params: RuntimeStartParams;
  error?: unknown;
};

export type RuntimeStopEvent = {
  error?: unknown;
};

export type RuntimeEvent =
  | { type: 'start'; data: RuntimeStartEvent }
  | { type: 'stop'; data: RuntimeStopEvent }
  | { type: 'execStart'; data: RuntimeExecStartEvent }
  | { type: 'execEnd'; data: RuntimeExecEndEvent };

export abstract class BaseRuntime {
  protected workdir = '/runtime-workspace';
  protected eventEmitter = new EventEmitter();

  public getWorkdir(workdir?: string | string[], parentWorkdir?: string) {
    return (
      (parentWorkdir || this.workdir) +
      (workdir ? '/' + (isArray(workdir) ? workdir.join('/') : workdir) : '')
    ).replace(/\/{2,}/, '/');
  }

  /**
   * Subscribe to runtime events
   * Returns an unsubscriber function
   */
  subscribe(callback: (event: RuntimeEvent) => Promise<void>): () => void {
    const handler = (event: RuntimeEvent) => callback(event);

    this.eventEmitter.on('event', handler);

    return () => {
      this.eventEmitter.off('event', handler);
    };
  }

  /**
   * Emit runtime events
   */
  protected emit(event: RuntimeEvent): void {
    this.eventEmitter.emit('event', event);
  }

  public abstract getRuntimeInfo(): string;

  abstract start(params: RuntimeStartParams): Promise<void>;
  abstract stop(): Promise<void>;
  abstract exec(params: RuntimeExecParams): Promise<RuntimeExecResult>;

  /**
   * Execute command with persistent streams for real-time communication
   * Returns properly demultiplexed stdin/stdout/stderr streams
   *
   * @param command - Command and arguments as array
   * @param options - Optional execution options (workdir, env)
   * @returns Promise with stdin/stdout/stderr streams and close function
   */
  abstract execStream(
    command: string[],
    options?: {
      workdir?: string;
      env?: Record<string, string>;
    },
  ): Promise<{
    stdin: Duplex;
    stdout: PassThrough;
    stderr: PassThrough;
    close: () => void;
  }>;

  public getGraphNodeMetadata(
    _meta: GraphExecutionMetadata,
  ): Record<string, unknown> | undefined {
    return undefined;
  }
}
