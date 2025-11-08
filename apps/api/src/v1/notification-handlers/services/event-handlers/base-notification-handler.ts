import { NotificationEvent } from '../../../notifications/notifications.types';
import { Notification } from '../../../notifications/notifications.types';
import { IEnrichedNotification } from '../../notification-handlers.types';

export abstract class BaseNotificationHandler<
  T extends IEnrichedNotification<unknown> = IEnrichedNotification<unknown>,
> {
  abstract readonly pattern: NotificationEvent | NotificationEvent[];

  abstract handle(event: Notification): Promise<T[]>;
}
