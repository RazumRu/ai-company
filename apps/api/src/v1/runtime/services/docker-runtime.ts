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
  private dindContainer: Docker.Container | null = null;
  private createdWorkdirs = new Set<string>();
  private containerWorkdir: string | null = null;

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
   * Also cleans up associated DIND containers
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

        await DockerRuntime.stopByInstance(container);
      } catch (error) {
        console.error(error);
      }
    });

    await Promise.all(cleanupPromises);
  }

  private async ensureImage(name: string) {
    const ref = name.includes(':') ? name : `${name}:latest`;
    try {
      await this.docker.getImage(ref).inspect();
    } catch {
      const stream = await this.docker.pull(ref);
      await new Promise<void>((res, rej) =>
        this.docker.modem.followProgress(
          stream,
          (err: Error | null | undefined) => (err ? rej(err) : res()),
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
        env,
        timeoutMs: timeoutMs || 10 * 60_000, // Default to 10 minutes if not specified
      });
      if (res.fail) {
        throw new Error(`Init failed: ${res.stderr || res.stdout}`);
      }
    }
  }

  /**
   * Wait until DIND dockerd is running and responsive (polls with timeout)
   */
  private async waitForDindReady(
    container: Docker.Container,
    timeoutMs = 30_000,
    intervalMs = 500,
  ): Promise<void> {
    const start = Date.now();
    for (;;) {
      const st = await container.inspect();
      if (st.State.Running) {
        try {
          // Probe: run `docker info` inside DIND
          const ex = await container.exec({
            Cmd: ['sh', '-lc', 'docker info >/dev/null 2>&1'],
            AttachStdout: true,
            AttachStderr: true,
            Tty: false,
          });
          const stream = await ex.start({ hijack: true, stdin: false });
          await new Promise<void>((resolve, reject) => {
            stream.on('end', resolve);
            stream.on('close', resolve);
            stream.on('error', reject);
          });
          const info = await ex.inspect();
          if (info.ExitCode === 0) {
            return;
          }
        } catch {
          //
        }
      }
      if (Date.now() - start >= timeoutMs) {
        throw new Error('DIND_NOT_READY');
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /**
   * Start a separate DIND (Docker-in-Docker) container
   */
  private async startDindContainer(
    containerName: string,
    network: string,
    labels?: Record<string, string>,
  ): Promise<Docker.Container> {
    if (this.dindContainer) {
      await DockerRuntime.stopByInstance(this.dindContainer);
    }

    const dindImage = 'docker:27-dind';

    // Check if DIND container already exists
    const existingDind = await this.getByName(containerName);
    if (existingDind) {
      await DockerRuntime.stopByInstance(existingDind);
    }

    // Ensure DIND image is available
    await this.ensureImage(dindImage);

    // Ensure network exists
    await this.ensureNetwork(network);

    // Create DIND-specific labels
    const dindLabels = {
      ...labels,
      'ai-company/dind': 'true',
      'ai-company/dind-for': containerName,
    };

    // Create DIND container with proper configuration
    const dindContainer = await this.docker.createContainer({
      Image: dindImage,
      name: containerName,
      Labels: dindLabels,
      Env: [
        'DOCKER_TLS_CERTDIR=', // Disable TLS
      ],
      Cmd: [
        'dockerd',
        '--host=tcp://0.0.0.0:2375',
        '--host=unix:///var/run/docker.sock',
      ],
      HostConfig: {
        Privileged: true, // Required for DIND
        NetworkMode: network,
      },
      Tty: false,
    });

    await dindContainer.start();

    // Wait for Docker daemon to be ready inside DIND container
    await this.waitForDindReady(dindContainer);

    return dindContainer;
  }

  async start(params?: RuntimeStartParams): Promise<void> {
    if (this.container) {
      await DockerRuntime.stopByInstance(this.container);
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
    const containerName = params?.containerName || `rt-${randomUUID()}`;
    const existingContainer = await this.getByName(containerName);

    if (existingContainer) {
      await DockerRuntime.stopByInstance(existingContainer);
    }

    // If no existing container found or recreate=true, create a new one
    await this.ensureImage(imageName);
    const cmd = ['sh', '-lc', 'while :; do sleep 2147483; done'];

    // Handle network configuration
    const networkName = params?.network || 'ai-company-runtime';
    await this.ensureNetwork(networkName);

    // Prepare environment variables
    let containerEnv = params?.env || {};

    // If DIND is enabled, set DOCKER_HOST to point to the DIND container
    if (params?.enableDind) {
      const dindContainerName = `dind-${containerName}`;

      this.dindContainer = await this.startDindContainer(
        dindContainerName,
        networkName,
        params?.labels,
      );

      containerEnv = {
        ...containerEnv,
        DOCKER_HOST: `tcp://dind-${containerName}:2375`,
      };
    }

    const env = this.prepareEnv(containerEnv);

    // Prepare host configuration
    const hostConfig: Docker.HostConfig = {
      NetworkMode: networkName,
      AutoRemove: true,
    };

    try {
      const container = await this.docker.createContainer({
        Image: imageName,
        name: containerName,
        Env: env,
        WorkingDir: this.getWorkdir(params?.workdir),
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
      this.containerWorkdir = this.getWorkdir(params?.workdir);

      if (params?.initScript) {
        await this.runInitScript(
          params.initScript,
          params.env,
          params.initScriptTimeoutMs,
        );
      }

      // Emit start event
      this.emit({ type: 'start', data: { params: params || {} } });
    } catch (error) {
      // Emit start event with error
      this.emit({ type: 'start', data: { params: params || {}, error } });
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      if (!this.container) {
        return;
      }

      await DockerRuntime.stopByInstance(this.container);
      this.container = null;
      this.containerWorkdir = null;

      // Stop and remove DIND container if it exists
      if (this.dindContainer) {
        await DockerRuntime.stopByInstance(this.dindContainer);
        this.dindContainer = null;
      }

      // Emit stop event
      this.emit({ type: 'stop', data: {} });
    } catch (error) {
      // Emit stop event with error
      this.emit({ type: 'stop', data: { error } });
      throw error;
    }
  }

  static async stopByInstance(container: Docker.Container): Promise<void> {
    await container.stop({ t: 10 }).catch(() => undefined);
    await container.remove({ force: true }).catch(() => undefined);
  }

  private async ensureChildWorkdir(workdir: string) {
    const fullWorkdir = this.getWorkdir(workdir, this.containerWorkdir || '');
    if (this.createdWorkdirs.has(fullWorkdir) || !this.container) {
      return fullWorkdir;
    }

    const ex = await this.container.exec({
      Cmd: ['sh', '-lc', `mkdir -p -- '${fullWorkdir.replace(/'/g, "'\\''")}'`],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = await ex.start({ hijack: true, stdin: false });
    await new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('close', resolve);
      stream.on('error', reject);
    });
    const info = await ex.inspect();
    if (info.ExitCode !== 0) {
      throw new Error('MKDIR_FAILED');
    }

    this.createdWorkdirs.add(fullWorkdir);

    return fullWorkdir;
  }

  async exec(params: RuntimeExecParams): Promise<RuntimeExecResult> {
    if (!this.container) {
      throw new Error('Runtime not started');
    }

    const execId = randomUUID();

    let fullWorkdir = this.containerWorkdir || undefined;
    if (params.childWorkdir) {
      fullWorkdir = params.createChildWorkdir
        ? await this.ensureChildWorkdir(params.childWorkdir)
        : this.getWorkdir(params.childWorkdir);
    }

    const cmd = Array.isArray(params.cmd)
      ? ['sh', '-lc', params.cmd.join(' && ')]
      : ['sh', '-lc', params.cmd];
    const env = this.prepareEnv(params.env);
    const abortController = new AbortController();

    const ex = await this.container.exec({
      Cmd: cmd,
      Env: env,
      WorkingDir: fullWorkdir,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      abortSignal: abortController.signal,
    });

    // Emit exec started event
    this.emit({
      type: 'execStart',
      data: { execId, params },
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
      if (tailTimer) {
        clearTimeout(tailTimer);
      }

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

    stdoutStream.on('data', onData);
    stderrStream.on('data', onData);

    const cleanup = () => {
      if (overallTimer) clearTimeout(overallTimer);
      if (tailTimer) clearTimeout(tailTimer);
      stdoutStream.removeListener('data', onData);
      stderrStream.removeListener('data', onData);
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          cleanup();
          abortController.abort();
          if (timedOut || tailTimedOut) {
            resolve();
          } else {
            resolve();
          }
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

      const result = { exitCode, stdout, stderr, fail: exitCode !== 0 };

      // Emit exec finished event
      this.emit({
        type: 'execEnd',
        data: { execId, params, result },
      });

      return result;
    } catch (error) {
      cleanup();

      // Emit exec finished event with error
      this.emit({
        type: 'execEnd',
        data: { execId, params, error },
      });

      throw error;
    }
  }
}
