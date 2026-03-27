import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/mikroorm';

import { WebhookProcessedEventDao } from './dao/webhook-processed-event.dao';
import { WebhookSyncStateDao } from './dao/webhook-sync-state.dao';
import { WebhookProcessedEventEntity } from './entities/webhook-processed-event.entity';
import { WebhookSyncStateEntity } from './entities/webhook-sync-state.entity';
import { PollableWebhookRegistry } from './services/pollable-webhook-registry.service';

@Module({
  imports: [
    registerEntities([WebhookSyncStateEntity, WebhookProcessedEventEntity]),
  ],
  providers: [
    WebhookSyncStateDao,
    WebhookProcessedEventDao,
    PollableWebhookRegistry,
  ],
  exports: [PollableWebhookRegistry],
})
export class WebhooksModule {}
