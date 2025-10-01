import { Injectable } from '@nestjs/common';

import { environment } from '../../../environments';
import { ProvideRuntimeParams, RuntimeType } from '../runtime.types';
import { BaseRuntime } from './base-runtime';
import { DockerRuntime } from './docker-runtime';

@Injectable()
export class RuntimeProvider {
  protected resolveRuntime(
    opts: ProvideRuntimeParams,
  ): BaseRuntime | undefined {
    switch (opts.type) {
      case RuntimeType.Docker:
        return new DockerRuntime({ socketPath: environment.dockerSocket });
    }
  }

  async provide(opts: ProvideRuntimeParams): Promise<BaseRuntime> {
    const runtime = this.resolveRuntime(opts);
    if (!runtime) throw new Error(`Runtime ${opts.type} is not supported`);

    if (opts.autostart) {
      await runtime.start({
        image: opts.image,
        env: opts.env,
        workdir: opts.workdir,
        labels: opts.labels,
        initScript: opts.initScript,
      });
    }

    return runtime;
  }
}
