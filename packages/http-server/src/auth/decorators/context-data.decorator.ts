import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { IContextData } from '../auth.types';
import { AuthContextStorage } from '../auth-context-storage';

export const CtxData = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): IContextData => {
    const request = ctx.switchToHttp().getRequest() as {
      __contextData: IContextData;
    };
    return request.__contextData;
  },
);

export const CtxStorage = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthContextStorage<IContextData> => {
    const request = ctx.switchToHttp().getRequest() as {
      __contextDataStorage: AuthContextStorage<IContextData>;
    };
    return request.__contextDataStorage;
  },
);
