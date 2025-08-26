import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export function IsPositiveStringNumber(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPositiveStringNumber',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [],
      options: {
        message: (args: ValidationArguments) =>
          `${args.property} must be a positive number`,
        ...(validationOptions || {}),
      },
      validator: {
        validate(value: any) {
          const parsedValue = Number(value);
          return !isNaN(parsedValue) && parsedValue > 0;
        },
      },
    });
  };
}
