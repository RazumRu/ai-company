import { UnauthorizedException } from '@packages/common';

import type { IContextData } from './auth.types';

export class AuthContextStorage<T extends IContextData = IContextData> {
  constructor(private readonly contextData: T | undefined) {}

  public get sub(): string | undefined {
    return this.contextData?.sub;
  }

  public checkSub(): string {
    const sub = this.sub;

    if (!sub) {
      throw new UnauthorizedException('UNAUTHORIZED', 'No sub');
    }

    return sub;
  }

  public context(): T | undefined {
    return this.contextData;
  }

  public get isAuthorized() {
    return !!this.contextData;
  }
}
