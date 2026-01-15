import type { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { isString } from 'lodash';

import { environment } from '../../../environments';
import type { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import {
  ProvideRuntimeInstanceParams,
  RuntimeStartParams,
  RuntimeType,
} from '../runtime.types';
import { BaseRuntime } from './base-runtime';
import type { RuntimeProvider } from './runtime-provider';

type RuntimeThreadProviderParams = Pick<
  ProvideRuntimeInstanceParams,
  'runtimeNodeId' | 'type' | 'runtimeStartParams' | 'temporary' | 'graphId'
>;

type RuntimeThreadAditionalParams = Pick<
  RuntimeStartParams,
  'initScript' | 'initScriptTimeoutMs' | 'env'
>;

@Injectable()
export class RuntimeThreadProvider {
  private additionalParams?: RuntimeThreadAditionalParams;

  constructor(
    private readonly runtimeProvider: RuntimeProvider,
    private params: RuntimeThreadProviderParams,
  ) {}

  public setParams(params: RuntimeThreadProviderParams) {
    this.params = params;
  }

  public getParams(): RuntimeThreadProviderParams {
    return this.params;
  }

  public setAdditionalParams(params: RuntimeThreadAditionalParams) {
    this.additionalParams = params;
  }

  async provide<T extends BaseRuntime>(
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<T> {
    const threadId =
      cfg.configurable?.parent_thread_id || cfg.configurable?.thread_id;
    if (!threadId) {
      throw new BadRequestException(
        undefined,
        'Thread id is required for runtime provisioning',
      );
    }

    let initScript = this.params.runtimeStartParams.initScript || [];
    if (initScript && isString(initScript)) {
      initScript = [initScript];
    }

    if (this.additionalParams?.initScript) {
      initScript = [...initScript, ...this.additionalParams.initScript];
    }

    return await this.runtimeProvider.provide<T>({
      ...this.params,
      runtimeStartParams: {
        ...this.params.runtimeStartParams,
        initScript,
        initScriptTimeoutMs:
          this.additionalParams?.initScriptTimeoutMs ||
          this.params.runtimeStartParams.initScriptTimeoutMs,
        env: {
          ...(this.params.runtimeStartParams.env || {}),
          ...(this.additionalParams?.env || {}),
        },
      },
      threadId,
    });
  }

  async cleanup(): Promise<void> {
    await this.runtimeProvider.cleanupRuntimesByNodeId(
      this.params.runtimeNodeId,
    );
  }

  public getRuntimeInfo(): string {
    const runtimeImage =
      this.params.runtimeStartParams.image ?? environment.dockerRuntimeImage;

    return dedent`
      Runtime type: ${this.params.type}
      ${runtimeImage ? `Runtime image: ${runtimeImage}` : ''}
      DIND available: ${this.params.runtimeStartParams.enableDind ? 'yes' : 'no'}
    `;
  }
}
