import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

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
      const raw = (event ?? {}) as Record<string, unknown>;
      const envelope = {
        type: raw.type,
        graphId: raw.graphId,
        threadId: raw.threadId,
        nodeId: raw.nodeId,
      };
      this.logger.error(
        parsed.error,
        'Invalid notification payload — dropping event',
        {
          eventType: raw.type,
          eventKeys: Object.keys(raw),
          envelope,
          issues: parsed.error.issues,
        },
      );
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
            { type: validated.type, graphId: validated.graphId },
          );
        }
      }),
    );
  }

  subscribe(cb: (event: Notification) => Promise<void>) {
    this.subscribers.push(cb);
  }
}
