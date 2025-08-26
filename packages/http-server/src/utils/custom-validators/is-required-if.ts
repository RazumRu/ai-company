import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { isUndefined } from 'lodash';

export function IsRequiredIf(
  cb: (object: any) => boolean,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isRequiredIf',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [cb],
      options: {
        message: (args: ValidationArguments) =>
          `${args.property} must be provided`,
        ...(validationOptions || {}),
      },
      validator: {
        validate(value: any, args: ValidationArguments) {
          const [cb] = args.constraints;

          if (cb(args.object) && isUndefined(value)) {
            return false;
          }

          return true;
        },
      },
    });
  };
}
