import { randomUUID } from 'node:crypto';
import { Duplex, PassThrough } from 'node:stream';

import { BadRequestException } from '@packages/common';
import Docker from 'dockerode';

import { environment } from '../../../environments';
import {
  RuntimeExecParams,
  RuntimeExecResult,
  RuntimeStartParams,
  RuntimeType,
} from '../runtime.types';
import { BaseRuntime } from './base-runtime';

type ShellSession = {
  id: string;
  exec: Docker.Exec;
  inputStream: Duplex;
  stdoutStream: PassThrough;
  stderrStream: PassThrough;
  stdoutBuffer: string;
  stderrBuffer: string;
  queue: SessionCommand[];
  busy: boolean;
  workdir: string;
};

type SessionCommand = {
  script: string;
  workdir: string;
  timeoutMs?: number;
  resolve: (res: RuntimeExecResult) => void;
  reject: (err: Error) => void;
};

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
  private sessions = new Map<string, ShellSession>();

  constructor(
    private dockerOptions?: Docker.DockerOptions,
    params?: { image?: string },
  ) {
    super();
    this.docker = new Docker(dockerOptions);
    this.image = params?.image;
  }

  static async cleanupByLabels(
    labels: Record<string, string>,
    dockerOptions?: Docker.DockerOptions,
  ): Promise<void> {
    const docker = new Docker(dockerOptions);

    const labelFilters = Object.entries(labels).map(([k, v]) => `${k}=${v}`);

    const containers = await docker.listContainers({
      all: true,
      filters: { label: labelFilters },
    });

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

  static async getByLabels(
    labels: Record<string, string>,
    dockerOptions?: Docker.DockerOptions,
  ): Promise<Docker.Container | null> {
    if (!labels || !Object.keys(labels).length) {
      return null;
    }

    const docker = new Docker(dockerOptions);

    const labelFilters = Object.entries(labels).map(([k, v]) => `${k}=${v}`);
    const list = await docker.listContainers({
      all: true,
      filters: { label: labelFilters },
    });

    if (!list[0]) {
      return null;
    }

    return docker.getContainer(list[0].Id);
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

  private shellEscape(value: string) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private buildEnvPrefix(env?: Record<string, string>) {
    if (!env || !Object.keys(env).length) {
      return '';
    }

    return `${Object.entries(env)
      .map(([k, v]) => `${k}=${this.shellEscape(v)}`)
      .join(' ')} `;
  }

  private async ensureSession(
    sessionId: string,
    workdir: string,
    env?: string[],
  ): Promise<ShellSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    if (!this.container) {
      throw new Error('Runtime not started');
    }

    const exec = await this.container.exec({
      Cmd: ['/bin/sh'],
      Env: env,
      WorkingDir: workdir,
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
      Tty: false,
    });

    const stream = (await exec.start({
      hijack: true,
      stdin: true,
    })) as unknown as Duplex;

    // Demux the stream into separate stdout/stderr streams
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);

    const session: ShellSession = {
      id: sessionId,
      exec,
      inputStream: stream,
      stdoutStream,
      stderrStream,
      stdoutBuffer: '',
      stderrBuffer: '',
      queue: [],
      busy: false,
      workdir,
    };

    const cleanup = () => {
      this.sessions.delete(sessionId);
      try {
        stream.removeAllListeners();
        stdoutStream.removeAllListeners();
        stderrStream.removeAllListeners();
      } catch {
        //
      }
    };

    stream.on('error', cleanup);
    stream.on('end', cleanup);
    stream.on('close', cleanup);

    this.sessions.set(sessionId, session);
    return session;
  }

  private enqueueSessionCommand(session: ShellSession, cmd: SessionCommand) {
    session.queue.push(cmd);
    void this.processSessionQueue(session);
  }

  private async processSessionQueue(session: ShellSession) {
    if (session.busy) return;

    const next = session.queue.shift();
    if (!next) return;

    session.busy = true;

    const marker = randomUUID();
    const endToken = `__AI_END_${marker}__`;
    const wrappedScript = [
      next.script,
      `printf "\\n${endToken}:%s\\n" $?`,
    ].join('; ');

    // Reset buffers for this command
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let finished = false;

    const onStdoutData = (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      const endTokenWithColon = `${endToken}:`;
      const endIdx = stdoutBuffer.indexOf(endTokenWithColon);

      if (endIdx === -1) {
        return;
      }

      const exitStart = endIdx + endTokenWithColon.length;
      const exitLineEnd = stdoutBuffer.indexOf('\n', exitStart);
      const exitData =
        exitLineEnd === -1
          ? stdoutBuffer.slice(exitStart)
          : stdoutBuffer.slice(exitStart, exitLineEnd);
      const parsed = Number.parseInt(exitData.trim() || '0', 10);
      const exitCode = Number.isNaN(parsed) ? 1 : parsed;

      // Get stdout content up to the end marker (excluding trailing newline before marker)
      let stdoutContent = stdoutBuffer.slice(0, endIdx);
      if (stdoutContent.endsWith('\n')) {
        stdoutContent = stdoutContent.slice(0, -1);
      }

      cleanupListeners();

      finished = true;
      next.resolve({
        exitCode,
        stdout: stdoutContent,
        stderr: stderrBuffer,
        fail: exitCode !== 0,
        execPath: next.workdir,
      });

      session.busy = false;
      void this.processSessionQueue(session);
    };

    const onStderrData = (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8');
    };

    const onError = (err: Error) => {
      if (finished) return;
      cleanupListeners();
      next.reject(err);
      session.busy = false;
      void this.processSessionQueue(session);
    };

    const cleanupListeners = () => {
      session.stdoutStream.off('data', onStdoutData);
      session.stderrStream.off('data', onStderrData);
      session.inputStream.off('error', onError);
      if (timeout) {
        clearTimeout(timeout);
      }
    };

    const timeout =
      next.timeoutMs && next.timeoutMs > 0
        ? setTimeout(() => {
            if (finished) return;
            cleanupListeners();
            next.resolve({
              exitCode: 124,
              stdout: stdoutBuffer,
              stderr: stderrBuffer || 'Process timed out',
              fail: true,
              execPath: next.workdir,
            });
            session.busy = false;
            void this.processSessionQueue(session);
          }, next.timeoutMs).unref()
        : null;

    session.stdoutStream.on('data', onStdoutData);
    session.stderrStream.on('data', onStderrData);
    session.inputStream.on('error', onError);

    try {
      session.inputStream.write(`${wrappedScript}\n`);
    } catch (error) {
      cleanupListeners();
      session.busy = false;
      next.reject(error as Error);
      void this.processSessionQueue(session);
    }
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

  private async getByName(name: string): Promise<Docker.Container | null> {
    try {
      const list = await this.docker.listContainers({
        all: true,
        filters: { name: [name] },
      });

      const exact = list.filter((c) =>
        c.Names?.some((n) => n.replace(/^\//, '') === name),
      );

      if (!exact[0]) {
        return null;
      }

      return this.docker.getContainer(exact[0].Id);
    } catch {
      return null;
    }
  }

  private async ensureNetwork(networkName: string): Promise<void> {
    try {
      const networks = await this.docker.listNetworks({
        filters: { name: [networkName] },
      });

      if (networks.length > 0) {
        return;
      }

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
        timeoutMs: timeoutMs || 10 * 60_000,
      });
      if (res.fail) {
        throw new Error(`Init failed: ${res.stderr || res.stdout}`);
      }
    }
  }

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

  private async createContainerWithRetry(
    containerName: string,
    createFn: () => Promise<Docker.Container>,
  ): Promise<Docker.Container> {
    try {
      return await createFn();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes('already in use') ||
        errorMessage.includes('name is already')
      ) {
        const conflictContainer = await this.getByName(containerName);
        if (conflictContainer) {
          await DockerRuntime.stopByInstance(conflictContainer);
        }

        return await createFn();
      }

      throw error;
    }
  }

  private async startDindContainer(
    containerName: string,
    network: string,
    labels?: Record<string, string>,
    recreate?: boolean,
  ): Promise<Docker.Container> {
    if (this.dindContainer && recreate) {
      await DockerRuntime.stopByInstance(this.dindContainer);
      this.dindContainer = null;
    }

    const dindImage = 'docker:27-dind';

    const existingDind = await this.getByName(containerName);
    if (existingDind && !recreate) {
      const inspect = await existingDind.inspect();
      if (!inspect.State.Running) {
        await existingDind.start();
      }
      await this.waitForDindReady(existingDind);
      return existingDind;
    }

    if (existingDind && recreate) {
      await DockerRuntime.stopByInstance(existingDind);
    }

    await this.ensureImage(dindImage);

    await this.ensureNetwork(network);

    const dindLabels = {
      ...labels,
      'ai-company/dind': 'true',
      'ai-company/dind-for': containerName,
    };

    const dindContainer = await this.createContainerWithRetry(
      containerName,
      async () => {
        return await this.docker.createContainer({
          Image: dindImage,
          name: containerName,
          Labels: dindLabels,
          Env: ['DOCKER_TLS_CERTDIR='],
          Cmd: [
            'dockerd',
            '--host=tcp://0.0.0.0:2375',
            '--host=unix:///var/run/docker.sock',
          ],
          HostConfig: {
            Privileged: true,
            NetworkMode: network,
          },
          Tty: false,
        });
      },
    );

    await dindContainer.start();

    await this.waitForDindReady(dindContainer);

    return dindContainer;
  }

  async start(params?: RuntimeStartParams): Promise<void> {
    if (this.container) {
      return;
    }

    const imageName =
      params?.image || this.image || environment.dockerRuntimeImage;
    if (!imageName) {
      throw new BadRequestException(
        'IMAGE_NOT_SPECIFIED',
        'Image not specified',
      );
    }
    this.image = imageName;

    const containerName = params?.containerName || `rt-${randomUUID()}`;
    const existingContainer = await this.getByName(containerName);

    if (existingContainer && !params?.recreate) {
      const inspect = await existingContainer.inspect();
      if (!inspect.State.Running) {
        await existingContainer.start();
      }

      this.container = existingContainer;
      this.containerWorkdir = this.getWorkdir(params?.workdir);

      this.emit({
        type: 'start',
        data: { params: params || {} },
      });

      return;
    }

    if (existingContainer && params?.recreate) {
      await DockerRuntime.stopByInstance(existingContainer);
    }

    await this.ensureImage(imageName);
    const cmd = ['sh', '-lc', 'while :; do sleep 2147483; done'];

    const networkName = params?.network || 'ai-company-runtime';
    await this.ensureNetwork(networkName);

    let containerEnv = params?.env || {};

    if (params?.enableDind) {
      const dindContainerName = `dind-${containerName}`;

      this.dindContainer = await this.startDindContainer(
        dindContainerName,
        networkName,
        params?.labels,
        params?.recreate,
      );

      containerEnv = {
        ...containerEnv,
        DOCKER_HOST: `tcp://dind-${containerName}:2375`,
      };
    }

    const env = this.prepareEnv(containerEnv);

    const hostConfig: Docker.HostConfig = {
      NetworkMode: networkName,
      AutoRemove: true,
    };

    try {
      const container = await this.createContainerWithRetry(
        containerName,
        async () => {
          return await this.docker.createContainer({
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
        },
      );

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

      this.emit({ type: 'start', data: { params: params || {} } });
    } catch (error) {
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
      this.sessions.clear();

      if (this.dindContainer) {
        await DockerRuntime.stopByInstance(this.dindContainer);
        this.dindContainer = null;
      }

      this.emit({ type: 'stop', data: {} });
    } catch (error) {
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

    let fullWorkdir = this.containerWorkdir || undefined;
    if (params.childWorkdir) {
      fullWorkdir = params.createChildWorkdir
        ? await this.ensureChildWorkdir(params.childWorkdir)
        : this.getWorkdir(params.childWorkdir);
    }

    if (!fullWorkdir) {
      fullWorkdir = this.workdir;
    }

    const env = this.prepareEnv(params.env);

    if (params.sessionId) {
      try {
        return await this.execInSession(params, fullWorkdir, env);
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        return {
          exitCode: 124,
          stdout: '',
          stderr: err,
          fail: true,
          execPath: fullWorkdir,
        };
      }
    }

    const execId = randomUUID();

    const cmd = Array.isArray(params.cmd)
      ? ['sh', '-lc', params.cmd.join(' && ')]
      : ['sh', '-lc', params.cmd];
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
          overallTimer = setTimeout(() => {
            timedOut = true;
            try {
              execStream.destroy(new Error('Process timed out'));
            } catch {
              //
            }
          }, params.timeoutMs).unref();
        }

        resetTailTimer();
      });

      const info = await ex.inspect();
      const exitCode = timedOut || tailTimedOut ? 124 : info.ExitCode || 0;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      const result: RuntimeExecResult = {
        exitCode,
        stdout,
        stderr,
        fail: exitCode !== 0,
        execPath: fullWorkdir,
      };

      this.emit({
        type: 'execEnd',
        data: { execId, params, result },
      });

      return result;
    } catch (error) {
      cleanup();

      this.emit({
        type: 'execEnd',
        data: { execId, params, error },
      });

      throw error;
    }
  }

  private async execInSession(
    params: RuntimeExecParams,
    workdir: string,
    env?: string[],
  ): Promise<RuntimeExecResult> {
    const sessionId = params.sessionId as string;
    const session = await this.ensureSession(sessionId, workdir, env);
    const envPrefix = this.buildEnvPrefix(params.env);
    const userCmd = Array.isArray(params.cmd)
      ? params.cmd.join(' && ')
      : params.cmd;

    // Don't add any cd prefix - the session shell maintains its own cwd.
    // Tools that need a specific directory (like files_list with dir parameter)
    // already wrap their commands in a subshell like (cd "$dir" && command).
    // This allows user `cd` commands to persist across session calls.
    const script = `${envPrefix}${userCmd || ':'}`;

    return await new Promise<RuntimeExecResult>((resolve, reject) => {
      this.enqueueSessionCommand(session, {
        script,
        workdir,
        timeoutMs: params.timeoutMs,
        resolve,
        reject,
      });
    });
  }

  public override getRuntimeInfo(): string {
    const runtimeImage = this.image ?? environment.dockerRuntimeImage;
    const infoLines = [
      `Runtime type: ${RuntimeType.Docker}`,
      runtimeImage ? `Runtime image: ${runtimeImage}` : null,
      `DIND available: ${this.dindContainer ? 'yes' : 'no'}`,
    ].filter(Boolean);

    return infoLines.join('\n');
  }
}
