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
} from '../runtime.types';
import { BaseRuntime } from './base-runtime';
import type { RuntimeProvider } from './runtime-provider';

type RuntimeThreadProviderParams = Pick<
  ProvideRuntimeInstanceParams,
  'runtimeNodeId' | 'type' | 'runtimeStartParams' | 'temporary' | 'graphId'
>;

type RuntimeThreadAdditionalParams = Pick<
  RuntimeStartParams,
  'initScript' | 'initScriptTimeoutMs' | 'env'
>;

@Injectable()
export class RuntimeThreadProvider {
  private additionalParams?: RuntimeThreadAdditionalParams;

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

  public setAdditionalParams(params: RuntimeThreadAdditionalParams) {
    const env =
      params.env && Object.keys(params.env).length ? params.env : null;
    const initScript = params.initScript
      ? Array.isArray(params.initScript)
        ? params.initScript
        : [params.initScript]
      : [];
    const initScriptTimeoutMs = params.initScriptTimeoutMs;

    if (!env && initScript.length === 0 && initScriptTimeoutMs === undefined) {
      return;
    }

    if (!this.additionalParams) {
      this.additionalParams = {};
    }

    if (env) {
      this.additionalParams.env = {
        ...(this.additionalParams.env ?? {}),
        ...env,
      };
    }

    if (initScript.length > 0) {
      const existing = this.additionalParams.initScript
        ? Array.isArray(this.additionalParams.initScript)
          ? this.additionalParams.initScript
          : [this.additionalParams.initScript]
        : [];
      this.additionalParams.initScript = [...existing, ...initScript];
    }

    if (initScriptTimeoutMs !== undefined) {
      this.additionalParams.initScriptTimeoutMs = Math.max(
        this.additionalParams.initScriptTimeoutMs ?? 0,
        initScriptTimeoutMs,
      );
    }
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
      const extra = Array.isArray(this.additionalParams.initScript)
        ? this.additionalParams.initScript
        : [this.additionalParams.initScript];
      initScript = [...initScript, ...extra];
    }

    return await this.runtimeProvider.provide<T>({
      ...this.params,
      runtimeStartParams: {
        ...this.params.runtimeStartParams,
        initScript,
        initScriptTimeoutMs: Math.max(
          this.params.runtimeStartParams.initScriptTimeoutMs ?? 0,
          this.additionalParams?.initScriptTimeoutMs ?? 0,
        ),
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
