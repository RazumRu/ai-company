import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';

import { BadRequestException } from '@packages/common';
import Docker from 'dockerode';

import {
  RuntimeExecParams,
  RuntimeExecResult,
  RuntimeStartParams,
} from '../runtime.types';
import { BaseRuntime } from './base-runtime';

/**
 * DockerRuntime using dockerode
 *
 * Each instance manages exactly one container lifecycle: start -> exec (any number) -> stop.
 * It respects standard Docker environment configuration (DOCKER_HOST, DOCKER_CERT_PATH, etc.).
 * For Podman, ensure the Docker-compatible socket is exposed and set via DOCKER_HOST.
 */
export class DockerRuntime extends BaseRuntime {
  private docker: Docker;
  private image?: string;
  private container: Docker.Container | null = null;

  constructor(
    dockerOptions?: Docker.DockerOptions,
    params?: {
      image?: string;
    },
  ) {
    super();

    this.docker = new Docker(dockerOptions);
    this.image = params?.image;
  }

  private get containerName(): string {
    return `ai-company-docker-runtime-${randomUUID()}`;
  }

  private async ensureImage(
    name: string,
  ): Promise<Docker.Image & { name: string }> {
    const ref = name.includes(':') ? name : `${name}:latest`;

    try {
      await this.docker.getImage(ref).inspect();
    } catch (e) {
      const stream = await this.docker.pull(ref);

      await new Promise<void>((res, rej) =>
        this.docker.modem.followProgress(stream, (err: any) =>
          err ? rej(err) : res(),
        ),
      );
    }

    return this.docker.getImage(ref) as Docker.Image & { name: string };
  }

  private prepareEnv(env?: Record<string, string>) {
    return env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : undefined;
  }

  async start(params?: RuntimeStartParams): Promise<void> {
    if (this.container) {
      const status = await this.container.inspect();

      if (status.State.Running || status.State.Restarting) {
        throw new Error('Runtime already started');
      }

      if (status.State.Paused || status.State.OOMKilled || status.State.Dead) {
        await this.container.start();
        return;
      }
    }

    const imageName = params?.image || this.image;

    if (!imageName) {
      throw new BadRequestException('Image not specified');
    }

    const image = await this.ensureImage(imageName);

    const env = this.prepareEnv(params?.env);
    const cmd = ['sh', '-lc', 'while :; do sleep 2147483; done'];

    const container = await this.docker.createContainer({
      Image: image.name,
      name: this.containerName,
      Env: env,
      WorkingDir: params?.workdir,
      Cmd: cmd,
      Tty: false,
      AttachStdin: false,
      AttachStdout: false,
      AttachStderr: false,
      OpenStdin: false,
    });

    await container.start();

    this.container = container;
  }

  async stop(): Promise<void> {
    if (!this.container) return;

    await this.container.stop({ t: 10 }).catch(() => undefined);
    await this.container.remove({ force: true }).catch(() => undefined);

    this.container = null;
  }

  async exec(params: RuntimeExecParams): Promise<RuntimeExecResult> {
    if (!this.container) throw new Error('Runtime not started');

    const cmd = Array.isArray(params.cmd)
      ? params.cmd
      : ['sh', '-lc', params.cmd];
    const env = this.prepareEnv(params.env);

    const abortController = new AbortController();

    const ex = await this.container.exec({
      Cmd: cmd,
      Env: env,
      WorkingDir: params.workdir,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      abortSignal: abortController.signal,
    });

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    stdoutStream.on('data', (c) => stdoutChunks.push(Buffer.from(c)));
    stderrStream.on('data', (c) => stderrChunks.push(Buffer.from(c)));

    const execStream = await ex.start({ hijack: true, stdin: false });
    this.docker.modem.demuxStream(execStream, stdoutStream, stderrStream);

    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        stdoutStream.removeAllListeners();
        stderrStream.removeAllListeners();
        execStream.removeAllListeners();
        stdoutStream.end();
        stderrStream.end();
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const fail = (e: Error) => {
        cleanup();
        abortController.abort();

        if (e.message.includes('Process timed out')) {
          resolve();
        } else {
          reject(e);
        }
      };

      execStream.on('end', done);
      execStream.on('close', done);
      execStream.on('error', fail);

      if (params.timeoutMs && params.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          try {
            execStream.destroy(new Error('Process timed out'));
          } catch {
            //
          }
        }, params.timeoutMs).unref();
      }
    });

    const info = await ex.inspect();

    const exitCode = timedOut ? 124 : info.ExitCode || 0;

    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8');

    return {
      exitCode,
      stdout,
      stderr,
      fail: exitCode !== 0,
    };
  }
}
