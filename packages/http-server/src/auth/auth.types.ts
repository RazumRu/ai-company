import { AuthProvider } from './providers/auth.provider';

export interface IContextData {
  sub?: string;
  [key: string]: unknown;
}

export interface IAuthModuleParams {
  provider?: AuthProvider;
  devMode?: boolean;
}
