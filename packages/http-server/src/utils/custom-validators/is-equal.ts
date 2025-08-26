import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export function IsEqual(value: any, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isEqual',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [value],
      options: {
        message: () => `${propertyName} must be equal to ${value}`,
        ...(validationOptions || {}),
      },
      validator: {
        validate(propertyValue: any, args: ValidationArguments) {
          return propertyValue === args.constraints[0];
        },
      },
    });
  };
}
