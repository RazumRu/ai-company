import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { WebhookSyncStateDao } from './dao/webhook-sync-state.dao';
import { WebhookSyncStateEntity } from './entities/webhook-sync-state.entity';
import { PollableWebhookRegistry } from './services/pollable-webhook-registry.service';

@Module({
  imports: [registerEntities([WebhookSyncStateEntity])],
  providers: [WebhookSyncStateDao, PollableWebhookRegistry],
  exports: [PollableWebhookRegistry],
})
export class WebhooksModule {}
