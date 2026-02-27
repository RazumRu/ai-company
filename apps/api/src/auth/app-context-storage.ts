import { UnauthorizedException } from '@nestjs/common';
import type { IContextData } from '@packages/http-server';
import { AuthContextStorage } from '@packages/http-server';
import type { FastifyRequest } from 'fastify';

export class AppContextStorage<
  T extends IContextData = IContextData,
> extends AuthContextStorage<T> {
  constructor(contextData: T | undefined, request: FastifyRequest) {
    super(contextData, request);
  }

  get projectId(): string | undefined {
    const raw = this.request.headers['x-project-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;

    return value;
  }

  checkProjectId(): string {
    const id = this.projectId;
    if (!id) {
      throw new UnauthorizedException('PROJECT_NOT_SELECTED');
    }

    return id;
  }
}
