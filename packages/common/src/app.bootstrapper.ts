import { Type } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces/modules/module-metadata.interface';
import { NestFactory } from '@nestjs/core';
import { compact, flatten } from 'lodash';

import { AppBootstrapperModule } from './app-bootstrapper.module';
import {
  IAppBootstrapperExtension,
  IAppBootstrapperParams,
} from './app-bootstrapper.types';
import { BaseLogger, ILoggerParams, LoggerModule } from './logger';

export class AppBootstrapper {
  private bootstrapModules: NonNullable<ModuleMetadata['imports']> = [];
  private defaultLogger?: Type<BaseLogger>;
  private loggerParams: ILoggerParams;
  private extensions: IAppBootstrapperExtension[] = [];

  constructor(private readonly params: IAppBootstrapperParams) {
    this.loggerParams = {
      environment: this.params.environment,
      appName: this.params.appName,
      appVersion: this.params.appVersion,
    };
  }

  public addModules(modules: NonNullable<ModuleMetadata['imports']>) {
    this.bootstrapModules.push(...modules);
  }

  public setupLogger(
    params: Omit<ILoggerParams, 'environment' | 'appName' | 'appVersion'>,
    logger?: Type<BaseLogger>,
  ) {
    this.loggerParams = {
      ...this.loggerParams,
      ...params,
    };

    if (logger) {
      this.defaultLogger = logger;
    }
  }

  public addExtension(extension: IAppBootstrapperExtension) {
    this.extensions.push(extension);
  }

  private buildLoggerModule() {
    const defaultExtensionLogger = this.extensions.find(
      (e) => e.defaultLogger,
    )?.defaultLogger;

    return LoggerModule.forRoot(
      {
        ...this.loggerParams,
        environment: this.params.environment,
        appName: this.params.appName,
        appVersion: this.params.appVersion,
      },
      this.defaultLogger ?? defaultExtensionLogger,
    );
  }

  public async init() {
    const appBootstrapperModule = AppBootstrapperModule.forRoot(
      compact([
        ...this.bootstrapModules,
        this.buildLoggerModule(),
        ...flatten(this.extensions.map((e) => e.modules)),
      ]),
      this.params,
    );

    const customBootstrapperList = compact(
      this.extensions.map((e) => e.customBootstrapper),
    );

    if (customBootstrapperList.length > 0) {
      for (const customBootstrapper of customBootstrapperList) {
        await customBootstrapper(appBootstrapperModule);
      }
    } else {
      const app = await NestFactory.createApplicationContext(
        appBootstrapperModule,
      );

      await app.init();
      await app.close();
    }
  }
}
