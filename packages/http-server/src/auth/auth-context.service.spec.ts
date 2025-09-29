import { UnauthorizedException } from '@packages/common';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import type { IAuthModuleParams, IContextData } from './auth.types';
import { AuthContextService } from './auth-context.service';
import { AuthProvider } from './providers/auth.provider';

class MockAuthProvider extends AuthProvider {
  constructor(
    private readonly opts: {
      token?: string;
      verifyResult?: IContextData;
    } = {},
  ) {
    super();
  }

  public getToken?(req: FastifyRequest): string | undefined {
    // return preset token if provided, else fall back to Authorization header
    if (this.opts.token) return this.opts.token;
    const auth = req?.headers?.authorization as string | undefined;
    return auth?.split(' ').pop();
  }

  public async verifyToken(token: string): Promise<IContextData> {
    return this.opts.verifyResult ?? { sub: token };
  }
}

describe('AuthContextService', () => {
  let req: FastifyRequest;

  beforeEach(() => {
    req = {
      headers: {},
    } as unknown as FastifyRequest;
  });

  describe('getToken', () => {
    it('uses authProvider.getToken when provided', () => {
      const provider = new MockAuthProvider({ token: 'prov-token' });
      const service = new AuthContextService(req, {}, provider);

      expect(service.getToken()).toBe('prov-token');
    });

    it('falls back to Authorization header when provider.getToken is not used', () => {
      const service = new AuthContextService(
        {
          headers: { authorization: 'Bearer abc.def' },
        } as unknown as FastifyRequest,
        {},
        undefined,
      );

      expect(service.getToken()).toBe('abc.def');
    });

    it('returns undefined when no token present', () => {
      const service = new AuthContextService(req, {}, undefined);
      expect(service.getToken()).toBeUndefined();
    });
  });

  describe('getDevUser', () => {
    it('parses x-dev-jwt-* headers and returns context object', () => {
      req.headers = {
        'x-dev-jwt-sub': 'user-1',
        'x-dev-jwt-roles': '["admin","user"]',
        'x-dev-jwt-meta': JSON.stringify({ a: 1 }),
        'x-ignore': 'nope',
      } as any;

      const service = new AuthContextService(req, {}, undefined);
      const ctx = service.getDevUser();

      expect(ctx).toEqual({
        sub: 'user-1',
        roles: ['admin', 'user'],
        meta: { a: 1 },
      });
    });

    it('returns undefined when no x-dev-jwt-* headers present', () => {
      req.headers = { other: 'header' } as any;
      const service = new AuthContextService(req, {}, undefined);
      expect(service.getDevUser()).toBeUndefined();
    });
  });

  describe('buildContextData', () => {
    it('returns dev user when devMode is true and dev headers present', async () => {
      req.headers = {
        'x-dev-jwt-sub': 'dev-user',
      } as any;
      const params: IAuthModuleParams = { devMode: true };
      const service = new AuthContextService(req, params, undefined);

      await expect(service.buildContextData()).resolves.toEqual({
        sub: 'dev-user',
      });
    });

    it('uses provider.verifyToken when token present and not in devMode', async () => {
      req.headers = { authorization: 'Bearer token-123' } as any;
      const provider = new MockAuthProvider({
        verifyResult: { sub: 'verified' },
      });
      const params: IAuthModuleParams = { devMode: false };
      const service = new AuthContextService(req, params, provider);

      await expect(service.buildContextData()).resolves.toEqual({
        sub: 'verified',
      });
    });

    it('returns undefined when no token or provider present', async () => {
      const service = new AuthContextService(
        req,
        { devMode: false },
        undefined,
      );
      await expect(service.buildContextData()).resolves.toBeUndefined();
    });
  });

  describe('init, sub, checkSub, context', () => {
    it('init stores context and getters work', async () => {
      const provider = new MockAuthProvider({
        verifyResult: { sub: 'u-1', name: 'John' },
      });
      req.headers = { authorization: 'Bearer anything' } as any;
      const service = new AuthContextService(req, { devMode: false }, provider);

      const ctx = await service.init();
      expect(ctx).toEqual({ sub: 'u-1', name: 'John' });
      expect(service.sub).toBe('u-1');
      expect(service.context()).toEqual({ sub: 'u-1', name: 'John' });
      expect(service.checkSub()).toBe('u-1');
    });

    it('checkSub throws UnauthorizedException when no sub', async () => {
      const provider = new MockAuthProvider({ verifyResult: {} });
      req.headers = { authorization: 'Bearer t' } as any;
      const service = new AuthContextService(req, { devMode: false }, provider);
      await service.init();

      expect(() => service.checkSub()).toThrowError(UnauthorizedException);
      try {
        service.checkSub();
      } catch (e: any) {
        expect(e?.statusCode).toBe(401);
        expect(e?.code).toBe('UNAUTHORIZED');
      }
    });
  });
});
