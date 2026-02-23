import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import {
  Notification,
  NotificationEvent,
} from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { IEnrichedNotification } from '../notification-handlers.types';
import { BaseNotificationHandler } from './event-handlers/base-notification-handler';

type EnrichedNotificationCallback = (
  event: IEnrichedNotification<unknown>,
) => Promise<void> | void;

@Injectable()
export class NotificationHandler {
  private readonly handlers = new Map<
    NotificationEvent,
    BaseNotificationHandler[]
  >();

  private callback: EnrichedNotificationCallback | undefined;

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly logger: DefaultLogger,
  ) {}

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
      try {
        await this.handleNotification(event);
      } catch (e) {
        this.logger.error(<Error>e, 'Failed to handle notification');
      }
    });
  }

  private async handleNotification(event: Notification): Promise<void> {
    const matchingHandlers = this.handlers.get(event.type) || [];

    for (const handler of matchingHandlers) {
      const result = await handler.handle(event);

      for (const item of result) {
        this.callback?.(item);
      }
    }
  }

  /**
   * Register a single callback for enriched notifications.
   * Replaces the previous EventEmitter-based subscribeEvents approach.
   */
  public onEnrichedNotification(cb: EnrichedNotificationCallback): void {
    this.callback = cb;
  }
}
