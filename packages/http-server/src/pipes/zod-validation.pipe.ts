import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ValidationException } from '@packages/common';
import z, { ZodError } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, { metatype }: ArgumentMetadata) {
    const schema: z.ZodTypeAny | undefined =
      (metatype as any)?.schema ?? (metatype as any)?.zodSchema;

    if (!schema) return value;

    const result = schema.safeParse(value, { reportInput: true });

    if (!result.success) {
      const e = result.error as ZodError;

      throw new ValidationException(
        'VALIDATION_ERROR',
        undefined,
        e.issues.map((i) => ({
          message: i.message,
          name: String(i.path[i.path.length - 1] ?? ''),
          path: i.path.join('.'),
          value: i.input,
        })),
      );
    }

    return result.data;
  }
}
