import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';

import { BadRequestException } from '@packages/common';
import Docker from 'dockerode';

import { environment } from '../../../environments';
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
    private dockerOptions?: Docker.DockerOptions,
    params?: { image?: string },
  ) {
    super();
    this.docker = new Docker(dockerOptions);
    this.image = params?.image;
  }

  /**
   * Stops and removes all containers matching the given labels
   * This is useful for cleaning up containers by graph_id or other labels
   */
  static async cleanupByLabels(
    labels: Record<string, string>,
    dockerOptions?: Docker.DockerOptions,
  ): Promise<void> {
    const docker = new Docker(dockerOptions);

    // Convert labels to Docker filter format
    const labelFilters = Object.entries(labels).map(([k, v]) => `${k}=${v}`);

    // List all containers (including stopped ones) matching the labels
    const containers = await docker.listContainers({
      all: true,
      filters: { label: labelFilters },
    });

    // Stop and remove each container
    const cleanupPromises = containers.map(async (containerInfo) => {
      try {
        const container = docker.getContainer(containerInfo.Id);

        // Stop the container if it's running
        if (containerInfo.State === 'running') {
          await container.stop({ t: 10 }).catch(() => undefined);
        }

        // Remove the container
        await container.remove({ force: true }).catch(() => undefined);
      } catch (error) {
        console.error(error);
      }
    });

    await Promise.all(cleanupPromises);
  }

  private generateContainerName(): string {
    return `rt-${randomUUID()}`;
  }

  private async ensureImage(name: string) {
    const ref = name.includes(':') ? name : `${name}:latest`;
    try {
      await this.docker.getImage(ref).inspect();
    } catch {
      const stream = await this.docker.pull(ref);
      await new Promise<void>((res, rej) =>
        this.docker.modem.followProgress(stream, (err: any) =>
          err ? rej(err) : res(),
        ),
      );
    }
    return this.docker.getImage(ref);
  }

  private prepareEnv(env?: Record<string, string>) {
    return env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : undefined;
  }

  private async getByLabels(labels?: Record<string, string>) {
    if (!labels || !Object.keys(labels).length) {
      return null;
    }

    const labelFilters = Object.entries(labels).map(([k, v]) => `${k}=${v}`);
    const list = await this.docker.listContainers({
      all: true,
      filters: { label: labelFilters },
    });
    if (!list[0]) {
      return null;
    }

    return this.docker.getContainer(list[0].Id);
  }

  /**
   * Check if a container with the given name already exists
   */
  private async getByName(name: string): Promise<Docker.Container | null> {
    try {
      const list = await this.docker.listContainers({
        all: true,
        filters: { name: [name] },
      });

      if (!list[0]) {
        return null;
      }

      return this.docker.getContainer(list[0].Id);
    } catch {
      return null;
    }
  }

  /**
   * Ensure a Docker network exists, create it if it doesn't
   */
  private async ensureNetwork(networkName: string): Promise<void> {
    try {
      // Check if network already exists
      const networks = await this.docker.listNetworks({
        filters: { name: [networkName] },
      });

      if (networks.length > 0) {
        return; // Network already exists
      }

      // Create the network
      await this.docker.createNetwork({
        Name: networkName,
        Driver: 'bridge',
        Labels: {
          'ai-company/managed': 'true',
          'ai-company/created-by': 'docker-runtime',
        },
      });
    } catch (error) {
      throw new Error(`Failed to create network ${networkName}: ${error}`);
    }
  }

  /**
   * Get network information
   */
  private async getNetwork(
    networkName: string,
  ): Promise<Docker.Network | null> {
    try {
      const networks = await this.docker.listNetworks({
        filters: { name: [networkName] },
      });

      if (networks.length === 0) {
        return null;
      }

      const networkId = networks[0]?.Id;
      if (!networkId) {
        return null;
      }

      return this.docker.getNetwork(networkId);
    } catch {
      return null;
    }
  }

  private async runInitScript(
    script?: string | string[],
    workdir?: string,
    env?: Record<string, string>,
    timeoutMs?: number,
  ) {
    if (!script) {
      return;
    }

    const cmds = Array.isArray(script) ? script : [script];
    for (const cmd of cmds) {
      const res = await this.exec({
        cmd,
        workdir,
        env,
        timeoutMs: timeoutMs || 10 * 60_000, // Default to 10 minutes if not specified
      });
      if (res.fail) {
        throw new Error(`Init failed: ${res.stderr || res.stdout}`);
      }
    }
  }

  async start(params?: RuntimeStartParams): Promise<void> {
    if (this.container) {
      const st = await this.container.inspect();

      if (st.State.Running || st.State.Restarting) {
        return;
      }

      if (st.State.Paused || st.State.OOMKilled || st.State.Dead) {
        await this.container.start();

        if (params?.initScript) {
          await this.runInitScript(
            params.initScript,
            params.workdir,
            params.env,
            params.initScriptTimeoutMs,
          );
        }

        return;
      }
    }

    const imageName =
      params?.image || this.image || environment.dockerRuntimeImage;
    if (!imageName) {
      throw new BadRequestException(
        'IMAGE_NOT_SPECIFIED',
        'Image not specified',
      );
    }

    // Determine container name: use provided name or generate a random one
    const containerName = params?.containerName || this.generateContainerName();

    // First, try to find an existing container by name (for graph restoration)
    const existingByName = await this.getByName(containerName);
    if (existingByName) {
      this.container = existingByName;
      const st = await existingByName.inspect();
      if (!st.State.Running) {
        await existingByName.start();
      }

      if (params?.initScript) {
        await this.runInitScript(
          params.initScript,
          params.workdir,
          params.env,
          params.initScriptTimeoutMs,
        );
      }

      return;
    }

    // // Second, try to find a reusable container by labels
    // const reusable = await this.getByLabels(params?.labels);
    // if (reusable) {
    //   this.container = reusable;
    //   const st = await reusable.inspect();
    //   if (!st.State.Running) {
    //     await reusable.start();
    //   }
    //
    //   if (params?.initScript) {
    //     await this.runInitScript(params.initScript, params.workdir, params.env);
    //   }
    //
    //   return;
    // }

    // If no existing container found, create a new one
    await this.ensureImage(imageName);
    const env = this.prepareEnv(params?.env);
    const cmd = ['sh', '-lc', 'while :; do sleep 2147483; done'];

    const dockerSocket =
      this.dockerOptions?.socketPath?.replace('unix://', '') ||
      '/var/run/docker.sock';

    // Handle network configuration
    if (params?.network) {
      await this.ensureNetwork(params.network);
    }

    // Prepare Docker-in-Docker binds if enabled
    const hostConfig: Docker.HostConfig = {
      Binds: [`${dockerSocket}:/var/run/docker.sock:rw`],
      Privileged: true,
      NetworkMode: params?.network || 'bridge',
    };

    const container = await this.docker.createContainer({
      Image: imageName,
      name: containerName,
      Env: env,
      WorkingDir: params?.workdir,
      Cmd: cmd,
      Labels: params?.labels,
      Tty: false,
      AttachStdin: false,
      AttachStdout: false,
      AttachStderr: false,
      OpenStdin: false,
      HostConfig: hostConfig,
    });

    await container.start();
    this.container = container;

    if (params?.initScript) {
      await this.runInitScript(
        params.initScript,
        params.workdir,
        params.env,
        params.initScriptTimeoutMs,
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.container) return;
    await this.container.stop({ t: 10 }).catch(() => undefined);
    await this.container.remove({ force: true }).catch(() => undefined);
    this.container = null;
  }

  /**
   * Clean up networks created by this runtime
   */
  async cleanupNetworks(networkName?: string): Promise<void> {
    try {
      if (networkName) {
        // Clean up specific network
        const network = await this.getNetwork(networkName);
        if (network) {
          const networkInfo = await network.inspect();
          // Only remove networks created by this runtime
          if (
            networkInfo.Labels?.['ai-company/created-by'] === 'docker-runtime'
          ) {
            await network.remove();
          }
        }
      } else {
        // Clean up all networks created by this runtime
        const networks = await this.docker.listNetworks({
          filters: { label: ['ai-company/created-by=docker-runtime'] },
        });

        for (const networkInfo of networks) {
          try {
            const network = this.docker.getNetwork(networkInfo.Id);
            await network.remove();
          } catch (error) {
            // Ignore errors when removing networks (they might be in use)
            console.warn(
              `Failed to remove network ${networkInfo.Name}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      console.warn('Failed to cleanup networks:', error);
    }
  }

  async exec(params: RuntimeExecParams): Promise<RuntimeExecResult> {
    if (!this.container) throw new Error('Runtime not started');

    const cmd = Array.isArray(params.cmd)
      ? ['sh', '-lc', ...params.cmd]
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
    let tailTimedOut = false;
    let overallTimer: NodeJS.Timeout | null = null;
    let tailTimer: NodeJS.Timeout | null = null;

    // Function to reset the tail timeout timer
    const resetTailTimer = () => {
      if (tailTimer) clearTimeout(tailTimer);

      if (params.tailTimeoutMs && params.tailTimeoutMs > 0) {
        tailTimer = setTimeout(() => {
          tailTimedOut = true;
          try {
            execStream.destroy(
              new Error('Process timed out - no logs received'),
            );
          } catch {
            //
          }
        }, params.tailTimeoutMs).unref();
      }
    };

    // Track data events to reset tail timeout
    const onData = () => {
      resetTailTimer();
    };

    stdoutStream.on('data', (c) => {
      stdoutChunks.push(Buffer.from(c));
      onData();
    });
    stderrStream.on('data', (c) => {
      stderrChunks.push(Buffer.from(c));
      onData();
    });

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        if (overallTimer) clearTimeout(overallTimer);
        if (tailTimer) clearTimeout(tailTimer);
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
        if (e.message.includes('Process timed out')) resolve();
        else reject(e);
      };

      execStream.on('end', done);
      execStream.on('close', done);
      execStream.on('error', fail);

      // Set up overall timeout
      if (params.timeoutMs && params.timeoutMs > 0) {
        overallTimer = setTimeout(() => {
          timedOut = true;
          try {
            execStream.destroy(new Error('Process timed out'));
          } catch {
            //
          }
        }, params.timeoutMs).unref();
      }

      // Set up initial tail timeout
      resetTailTimer();
    });

    const info = await ex.inspect();
    const exitCode = timedOut || tailTimedOut ? 124 : info.ExitCode || 0;
    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8');

    return { exitCode, stdout, stderr, fail: exitCode !== 0 };
  }
}
