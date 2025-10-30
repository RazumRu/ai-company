import { DynamicModule, Module } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces/modules/module-metadata.interface';

import { IAppBootstrapperParams } from './app-bootstrapper.types';
import { AppBootstrapperConfigModule } from './app-bootstrapper-config.module';

@Module({})
export class AppBootstrapperModule {
  static forRoot(
    bootstrapModules: ModuleMetadata['imports'],
    parameters: IAppBootstrapperParams,
  ): DynamicModule {
    return {
      module: AppBootstrapperModule,
      imports: [
        AppBootstrapperConfigModule.forRoot(parameters),
        ...(bootstrapModules || []),
      ],
      providers: [],
      exports: [],
      controllers: [],
    };
  }
}
