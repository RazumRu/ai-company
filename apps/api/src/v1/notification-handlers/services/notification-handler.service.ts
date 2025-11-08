import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { EventEmitter } from 'events';

import {
  Notification,
  NotificationEvent,
} from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { IEnrichedNotification } from '../notification-handlers.types';
import { BaseNotificationHandler } from './event-handlers/base-notification-handler';

@Injectable()
export class NotificationHandler extends EventEmitter {
  private readonly handlers = new Map<
    NotificationEvent,
    BaseNotificationHandler[]
  >();

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly logger: DefaultLogger,
  ) {
    super();
  }

  /**
   * Register an event handler
   */
  registerHandler(handler: BaseNotificationHandler): void {
    const patterns = Array.isArray(handler.pattern)
      ? handler.pattern
      : [handler.pattern];

    for (const type of patterns) {
      if (!this.handlers.has(type)) {
        this.handlers.set(type, []);
      }

      this.handlers.get(type)!.push(handler);
    }
  }

  async init() {
    // Subscribe to notifications service events
    this.notificationsService.subscribe(async (event) => {
      await this.handleNotification(event);
    });
  }

  private async handleNotification(event: Notification): Promise<void> {
    const matchingHandlers = this.handlers.get(event.type) || [];

    for (const handler of matchingHandlers) {
      const result = await handler.handle(event);

      for (const item of result) {
        this.emit('enriched_notification', item);
      }
    }
  }

  public subscribeEvents(
    cb: (event: IEnrichedNotification<unknown>) => Promise<void> | void,
  ) {
    this.on('enriched_notification', cb);
  }
}
