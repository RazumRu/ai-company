import EventEmitter from 'node:events';

import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { Notification } from '../notifications.types';

@Injectable()
export class NotificationsService {
  private emitter: EventEmitter;

  constructor(private readonly logger: DefaultLogger) {
    this.emitter = new EventEmitter();
  }

  emit(event: Notification) {
    this.logger.debug('notifications.emit', event);
    this.emitter.emit('event', event);
  }

  subscribe(cb: (event: Notification) => Promise<void>) {
    this.emitter.on('event', cb);
  }
}
