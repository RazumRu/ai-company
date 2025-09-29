import { FastifyRequest } from 'fastify';

import { IContextData } from '../auth.types';

export abstract class AuthProvider {
  public getToken?(req: FastifyRequest): string | undefined;
  public abstract verifyToken(token: string): Promise<IContextData>;
}
