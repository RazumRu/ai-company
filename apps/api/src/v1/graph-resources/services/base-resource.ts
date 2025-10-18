import { DefaultLogger } from '@packages/common';

import { IBaseResourceOutput } from '../graph-resources.types';

export abstract class BaseResource<
  TConfig = unknown,
  TOutput extends IBaseResourceOutput<any> = IBaseResourceOutput<unknown>,
> {
  constructor(protected readonly logger?: DefaultLogger) {}

  public setup?(config: TConfig): Promise<void>;

  public abstract getData(config: TConfig): Promise<TOutput>;
}
