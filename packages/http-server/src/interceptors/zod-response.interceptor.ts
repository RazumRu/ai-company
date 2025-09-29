import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { pick } from 'lodash';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import z from 'zod';

const getZod = (dto: any): z.ZodTypeAny | undefined =>
  dto?.schema ?? dto?.zodSchema;

@Injectable()
export class ZodResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const meta =
      this.reflector.getAllAndOverride(DECORATORS.API_RESPONSE, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) || {};

    const resp = meta['200'] || meta['201'] || meta['default'];
    const dto = resp?.type;
    const schema = getZod(dto);
    if (!schema) return next.handle();
    const schemaDef = ((schema.def as any).shape || {}) as Record<string, any>;

    const s = resp?.isArray ? z.array(schema) : schema;
    return next.handle().pipe(
      map((d) => {
        const data = s.safeParse(d);

        if (!data.error) {
          return data.data;
        } else {
          return pick(d, Object.keys(schemaDef));
        }
      }),
    );
  }
}
