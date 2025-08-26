import { DynamicModule, Type } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces/modules/module-metadata.interface';

import { BaseLogger } from './logger';

export interface IAppBootstrapperParams {
  environment: string;
  appName: string;
  appVersion: string;
}

export const BootstrapParameters = Symbol('BootstrapParameters');

export interface IAppBootstrapperExtension {
  modules: NonNullable<ModuleMetadata['imports']>;
  defaultLogger?: Type<BaseLogger>;
  customBootstrapper?: (module: DynamicModule) => Promise<void>;
}
