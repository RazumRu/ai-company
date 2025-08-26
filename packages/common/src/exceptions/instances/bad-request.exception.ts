import { BaseException } from './base.exception';

export class BadRequestException extends BaseException {
  constructor(errorCode?: string, customData?: Record<string, any>);
  constructor(
    errorCode?: string,
    description?: string,
    customData?: Record<string, any>,
  );
  constructor(
    errorCode: string = 'BAD_REQUEST',
    description?: Record<string, any> | string,
    customData?: Record<string, any>,
  ) {
    if (typeof description === 'object') {
      customData = description;
      description = undefined;
    }

    super(errorCode, 400, {
      description,
      customData,
    });

    this.name = BadRequestException.name;
  }
}
