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

export const BASE_RUNTIME_WORKDIR = '/runtime-workspace';

export abstract class BaseRuntime {
  protected workdir = BASE_RUNTIME_WORKDIR;
  protected eventEmitter = new EventEmitter();

  protected appendTail(prev: string, chunk: Buffer, max: number): string;
  protected appendTail(
    prev: Buffer<ArrayBufferLike>,
    chunk: Buffer<ArrayBufferLike>,
    max: number,
  ): Buffer<ArrayBufferLike>;
  protected appendTail(
    prev: string | Buffer<ArrayBufferLike>,
    chunk: Buffer<ArrayBufferLike>,
    max: number,
  ) {
    if (typeof prev === 'string') {
      const next = chunk.toString('utf8');
      if (!prev) {
        return next.length <= max ? next : next.slice(next.length - max);
      }
      const combined = prev + next;
      if (combined.length <= max) return combined;
      return combined.slice(combined.length - max);
    }

    const combined = (prev.length ? Buffer.concat([prev, chunk]) : chunk) as
      | Buffer<ArrayBufferLike>
      | Buffer<ArrayBuffer>;
    if (combined.length <= max) return combined as Buffer<ArrayBufferLike>;
    return combined.subarray(combined.length - max) as Buffer<ArrayBufferLike>;
  }

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
