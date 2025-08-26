import { AuthProvider } from './providers/auth.provider';

export interface IContextData {
  sub?: string;
}

export interface IAuthModuleParams {
  provider?: AuthProvider;
  devMode?: boolean;
}
