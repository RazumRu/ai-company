import { isArray } from 'lodash';

import {
  RuntimeExecParams,
  RuntimeExecResult,
  RuntimeStartParams,
} from '../runtime.types';

export abstract class BaseRuntime {
  private workdir = '/runtime-workspace';

  public getWorkdir(workdir?: string | string[], parentWorkdir?: string) {
    return (
      (parentWorkdir || this.workdir) +
      (workdir ? '/' + (isArray(workdir) ? workdir.join('/') : workdir) : '')
    ).replace(/\/{2,}/, '/');
  }

  abstract start(params: RuntimeStartParams): Promise<void>;
  abstract stop(): Promise<void>;
  abstract exec(params: RuntimeExecParams): Promise<RuntimeExecResult>;
}
