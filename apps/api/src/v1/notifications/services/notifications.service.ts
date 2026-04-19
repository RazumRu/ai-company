import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { environment } from '../../../environments';
import { Notification, NotificationSchema } from '../notifications.types';

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
    const parsed = NotificationSchema.safeParse(event);
    if (!parsed.success) {
      this.logger.error(
        parsed.error,
        'Invalid notification payload — dropping event',
        {
          type: (event as { type?: string })?.type,
          graphId: (event as { graphId?: string })?.graphId,
          issues: parsed.error.issues,
        },
      );
      if (environment.env !== 'production') {
        throw parsed.error;
      }
      return;
    }

    const validated = parsed.data;
    await Promise.all(
      this.subscribers.map(async (subscriber) => {
        try {
          await subscriber(validated);
        } catch (error) {
          this.logger.error(
            error as Error,
            'Subscriber failed to process notification',
            {
              type: validated.type,
              graphId: validated.graphId,
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
