import { BaseException } from './base.exception';

export class InternalException extends BaseException {
  constructor(errorCode?: string, customData?: Record<string, any>);
  constructor(
    errorCode?: string,
    description?: string,
    customData?: Record<string, any>,
  );
  constructor(
    errorCode: string = 'INTERNAL_SERVER_ERROR',
    description?: Record<string, any> | string,
    customData?: Record<string, any>,
  ) {
    if (typeof description === 'object') {
      customData = description;
      description = undefined;
    }

    super(errorCode, 500, {
      description,
      customData,
    });

    this.name = InternalException.name;
  }
}
