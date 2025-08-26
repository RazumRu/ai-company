import { BaseException } from './base.exception';

export class UnauthorizedException extends BaseException {
  constructor(errorCode?: string, customData?: Record<string, any>);
  constructor(
    errorCode?: string,
    description?: string,
    customData?: Record<string, any>,
  );
  constructor(
    errorCode: string = 'UNAUTHORIZED',
    description?: Record<string, any> | string,
    customData?: Record<string, any>,
  ) {
    if (typeof description === 'object') {
      customData = description;
      description = undefined;
    }

    super(errorCode, 401, {
      description,
      customData,
    });

    this.name = UnauthorizedException.name;
  }
}
