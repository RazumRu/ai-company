import { EventEmitter } from 'events';
import { isArray } from 'lodash';

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
  private workdir = '/runtime-workspace';
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

  abstract start(params: RuntimeStartParams): Promise<void>;
  abstract stop(): Promise<void>;
  abstract exec(params: RuntimeExecParams): Promise<RuntimeExecResult>;
}
