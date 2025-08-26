import { AppBootstrapper } from './app.bootstrapper';
import { IAppBootstrapperParams } from './app-bootstrapper.types';

export const buildBootstrapper = (params: IAppBootstrapperParams) => {
  const instance = new AppBootstrapper(params);

  return instance;
};

export function getEnv(env: string, value: boolean): boolean;
export function getEnv(env: string, value: string): string;
export function getEnv(env: string): string;
export function getEnv(
  env: string,
  value?: string | boolean,
): string | boolean {
  const v = process.env[env] === undefined ? value : process.env[env];

  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return v as string;
}
