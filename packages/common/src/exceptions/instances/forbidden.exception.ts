import { BaseException } from './base.exception';

export class ForbiddenException extends BaseException {
  constructor(errorCode?: string, customData?: Record<string, any>);
  constructor(
    errorCode?: string,
    description?: string,
    customData?: Record<string, any>,
  );
  constructor(
    errorCode: string = 'FORBIDDEN',
    description?: Record<string, any> | string,
    customData?: Record<string, any>,
  ) {
    if (typeof description === 'object') {
      customData = description;
      description = undefined;
    }

    super(errorCode, 403, {
      description,
      customData,
    });

    this.name = ForbiddenException.name;
  }
}
