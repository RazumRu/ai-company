import { Inject, Injectable, Optional, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { UnauthorizedException } from '@packages/common';
import type { FastifyRequest } from 'fastify';

import * as httpServerTypes from '../http-server.types';
import type { IAuthModuleParams, IContextData } from './auth.types';
import { AuthProvider } from './providers/auth.provider';

@Injectable({ scope: Scope.REQUEST })
export class AuthContextService {
  private contextData: IContextData | undefined;

  constructor(
    @Inject(REQUEST)
    protected readonly request: FastifyRequest,
    @Inject(httpServerTypes.HttpServerAuthParams)
    private readonly params?: IAuthModuleParams,
    @Inject(AuthProvider)
    @Optional()
    private readonly authProvider?: AuthProvider,
  ) {}

  public async init() {
    const contextData = await this.buildContextData();

    this.contextData = contextData;

    return contextData;
  }

  public getToken(): string | undefined {
    const jwtHeader = this.request?.headers?.authorization;
    const token = jwtHeader?.split(' ').pop();

    return token;
  }

  public getDevUser(): string | undefined {
    const devUser = this.request?.headers?.['x-dev-user'];
    return Array.isArray(devUser) ? devUser[0] : devUser;
  }

  public async buildContextData(): Promise<IContextData | undefined> {
    const token = this.getToken();
    const isDevMode = this.params?.devMode;

    if (isDevMode) {
      const devUser = this.getDevUser();

      if (devUser) {
        return {
          sub: devUser,
        };
      }
    }

    if (!token || !this.authProvider) {
      return undefined;
    }

    const tokenData = await this.authProvider.verifyToken(token);

    return {
      sub: tokenData.sub,
    };
  }

  public get sub(): string | undefined {
    return this.contextData?.sub;
  }

  public checkSub(): string {
    const sub = this.sub;

    if (!sub) {
      throw new UnauthorizedException('UNAUTHORIZED', 'No sub');
    }

    return sub;
  }
}
