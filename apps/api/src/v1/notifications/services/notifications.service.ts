import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { Notification } from '../notifications.types';

/**
 * Synchronous in-process notification dispatcher.
 *
 * Notifications are dispatched directly to subscribers without a BullMQ
 * queue.  This is simpler, lower-latency, and avoids the requirement that
 * all notification payloads be JSON-serializable (e.g. BaseMessage
 * instances can now flow through unchanged).
 */
@Injectable()
export class NotificationsService {
  private subscribers: ((notification: Notification) => Promise<void>)[] = [];

  constructor(private readonly logger: DefaultLogger) {}

  async emit(event: Notification): Promise<void> {
    await Promise.all(
      this.subscribers.map(async (subscriber) => {
        try {
          await subscriber(event);
        } catch (error) {
          this.logger.error(
            <Error>error,
            'Subscriber failed to process notification',
            {
              type: event.type,
              graphId: event.graphId,
            },
          );
        }
      }),
    );
  }

  subscribe(cb: (event: Notification) => Promise<void>) {
    this.subscribers.push(cb);
  }
}
