export enum WebhookSubscriberType {
  GhIssue = 'gh_issue',
}

export interface PollableWebhookSubscriber<T> {
  subscriberKey: WebhookSubscriberType;
  pollFn(since: Date): Promise<T[]>;
  onEvent(payload: T): Promise<void>;
}
