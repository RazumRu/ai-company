import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplication,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    if (!this.redisUrl) {
      return;
    }

    try {
      const pubClient = new IORedis(this.redisUrl, {
        maxRetriesPerRequest: null,
      });
      const subClient = pubClient.duplicate();

      await Promise.all([
        new Promise<void>((resolve) => pubClient.on('ready', resolve)),
        new Promise<void>((resolve) => subClient.on('ready', resolve)),
      ]);

      this.adapterConstructor = createAdapter(pubClient, subClient);
    } catch {
      // Fall back to in-memory adapter if Redis is unavailable.
      // This is expected in development when Redis may not be running.
    }
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }
}
