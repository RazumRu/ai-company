import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { IContextData } from '../auth.types';

export const ContextData = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): IContextData => {
    const request = ctx.switchToHttp().getRequest();
    return request.__contextData;
  },
);
