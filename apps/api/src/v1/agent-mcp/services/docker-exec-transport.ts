import { Duplex, PassThrough } from 'node:stream';

import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { DefaultLogger } from '@packages/common';

import { BaseRuntime } from '../../runtime/services/base-runtime';

/**
 * Custom MCP transport using DockerRuntime.execStream
 * Communicates with MCP servers running inside Docker containers
 * Streams are already properly demultiplexed by DockerRuntime
 */
export class DockerExecTransport implements Transport {
  private stdin?: Duplex;
  private stdout?: PassThrough;
  private stderr?: PassThrough;
  private closeStream?: () => void;
  private buffer = '';
  private isConnected = false;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: unknown) => void;

  constructor(
    private readonly getRuntimeInstance: () => BaseRuntime,
    private readonly command: string,
    private readonly args: string[],
    private readonly env: Record<string, string>,
    private readonly logger: DefaultLogger,
  ) {}

  public async start(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    // Get runtime instance dynamically
    const runtime = this.getRuntimeInstance();

    // Get properly demuxed streams from runtime
    if (!('execStream' in runtime)) {
      throw new Error('Runtime does not support execStream');
    }

    const streams = await (
      runtime as {
        execStream: (
          cmd: string[],
          opts: { env: Record<string, string> },
        ) => Promise<{
          stdin: Duplex;
          stdout: PassThrough;
          stderr: PassThrough;
          close: () => void;
        }>;
      }
    ).execStream([this.command, ...this.args], {
      env: this.env,
    });

    this.stdin = streams.stdin;
    this.stdout = streams.stdout;
    this.stderr = streams.stderr;
    this.closeStream = streams.close;

    // stdout is already demuxed - just parse JSON-RPC line by line
    this.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line) as unknown;
            if (this.onmessage) {
              this.onmessage(message);
            }
          } catch (error) {
            this.logger.error(
              error instanceof Error ? error : new Error(String(error)),
              `Failed to parse MCP message: ${line}`,
            );
          }
        }
      }
    });

    this.stdin!.on('error', (error: Error) => {
      this.logger.error(error, 'DockerExecTransport error');
      if (this.onerror) {
        this.onerror(error);
      }
      this.close();
    });

    this.stdin!.on('close', () => {
      if (this.onclose) {
        this.onclose();
      }
      this.close();
    });

    this.isConnected = true;
  }

  public send(message: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.stdin) {
        reject(new Error('Transport not connected'));
        return;
      }

      const success = this.stdin.write(JSON.stringify(message) + '\n');
      if (success) {
        resolve();
      } else {
        this.stdin.once('drain', () => resolve());
      }
    });
  }

  public async close(): Promise<void> {
    if (this.isConnected) {
      this.closeStream?.();
      this.isConnected = false;
    }
  }
}
