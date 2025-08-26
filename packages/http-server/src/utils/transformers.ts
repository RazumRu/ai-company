import { Transform } from 'class-transformer';
import { isNumberString } from 'class-validator';
import { isArray, isNumber, isString } from 'lodash';

export const TransformQueryArray = (type?: (...args: unknown[]) => unknown) => {
  return function (target: object, propertyKey: string | symbol) {
    Transform((params) => {
      let val = params.obj[params.key];

      if (isString(val)) {
        val = val.split(',');
      }

      return val?.map((v: unknown) => (type ? type(v) : v));
    })(target, propertyKey);
  };
};

export type TransformEnumOptions<T extends { [key: string]: any }> = {
  /**
   * Indicates if multiple enum values can be used as the same time (thus being an array).
   * Defaults to `false`.
   */
  isArray?: boolean;

  /**
   * The enum that should be represented.
   */
  enum: T;

  /**
   * The type of the enum values. Defaults to `'number'`.
   */
  type?: 'string' | 'number';
};

export const TransformEnum = <T extends { [key: string]: any }>(
  options: TransformEnumOptions<T>,
) => {
  return function (target: object, propertyKey: string | symbol) {
    Transform((params) => {
      let val = params.obj[params.key];

      if (!isArray(val)) {
        val = [val];
      }

      for (const i in val) {
        if (options.type === 'number' && !isNumber(val[i])) {
          if (isNumberString(val[i])) {
            val[i] = Number(val[i]);
          } else {
            val[i] = options.enum[val[i]];
          }
        }

        if (options.type === 'string' && !isString(val[i])) {
          val[i] = options.enum[val[i]];
        }
      }

      return options.isArray ? val : val[0];
    })(target, propertyKey);
  };
};
