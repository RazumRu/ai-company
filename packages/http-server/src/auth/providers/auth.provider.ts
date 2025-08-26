import { IContextData } from '../auth.types';

export abstract class AuthProvider {
  public abstract verifyToken(token: string): Promise<IContextData>;
}
