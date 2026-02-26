import { NotificationEvent } from '../notifications/notifications.types';

export enum NotificationScope {
  /** Send notification only to graph room (users who explicitly subscribed) */
  Graph = 'graph',
  /** Send notification only to user room (owner's personal room) */
  User = 'user',
}

export interface IEnrichedNotification<T> {
  type: NotificationEvent;
  data: T;
  graphId: string;
  projectId: string;
  ownerId: string;
  nodeId?: string;
  threadId?: string;
  runId?: string;
  scope: NotificationScope[];
}
