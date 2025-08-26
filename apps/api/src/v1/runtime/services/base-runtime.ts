import {
  RuntimeExecParams,
  RuntimeExecResult,
  RuntimeStartParams,
} from '../runtime.types';

export abstract class BaseRuntime {
  abstract start(params: RuntimeStartParams): Promise<void>;
  abstract stop(): Promise<void>;
  abstract exec(params: RuntimeExecParams): Promise<RuntimeExecResult>;
}
