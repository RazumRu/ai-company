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
    if (this.authProvider?.getToken) {
      return this.authProvider?.getToken(this.request);
    }

    const jwtHeader = this.request?.headers?.authorization;
    const token = jwtHeader?.split(' ').pop();

    return token;
  }

  public getDevUser(): IContextData | undefined {
    const context = Object.entries(this.request?.headers).reduce(
      (acc: IContextData, [key, value]) => {
        if (key.startsWith('x-dev-jwt-')) {
          const propKey = key.replace('x-dev-jwt-', '');
          let preparedValue = value;

          if (typeof preparedValue === 'string') {
            try {
              preparedValue = JSON.parse(preparedValue);
            } catch {
              // ignore
            }
          }

          acc[propKey] = preparedValue;
        }

        return acc;
      },
      {},
    );

    if (Object.keys(context).length === 0) {
      return undefined;
    }

    return context;
  }

  public async buildContextData(): Promise<IContextData | undefined> {
    const token = this.getToken();
    const isDevMode = this.params?.devMode;

    if (isDevMode) {
      const ctx = this.getDevUser();

      if (ctx) {
        return ctx;
      }
    }

    if (!token || !this.authProvider) {
      return undefined;
    }

    return this.authProvider.verifyToken(token);
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

  public context<T extends IContextData>(): T {
    return this.contextData as T;
  }

  public get isAuthorized() {
    return !!this.contextData;
  }
}
