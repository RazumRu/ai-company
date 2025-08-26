import { Injectable } from '@nestjs/common';

import { environment } from '../../../environments';
import { RuntimeType } from '../runtime.types';
import { BaseRuntime } from './base-runtime';
import { DockerRuntime } from './docker-runtime';

@Injectable()
export class RuntimeOrchestrator {
  public getRuntime<T extends BaseRuntime>(
    type: RuntimeType,
    image?: string,
  ): T {
    switch (type) {
      case RuntimeType.Docker:
        return this.resolveDockerRuntime(image) as unknown as T;
      default:
        throw new Error(`Runtime ${type} is not supported`);
    }
  }

  private resolveDockerRuntime(image?: string) {
    return new DockerRuntime(
      {
        socketPath: environment.dockerSocket,
      },
      {
        image,
      },
    );
  }
}
