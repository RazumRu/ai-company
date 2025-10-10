import { Module, OnModuleInit } from '@nestjs/common';

import { GraphsModule } from '../graphs/graphs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SocketGateway } from './gateways/socket.gateway';
import { CheckpointerNotificationHandler } from './services/event-handlers/checkpointer-notification-handler';
import { GraphNotificationHandler } from './services/event-handlers/graph-notification-handler';
import { NotificationHandler } from './services/notification-handler.service';

@Module({
  imports: [GraphsModule, NotificationsModule],
  providers: [
    GraphNotificationHandler,
    CheckpointerNotificationHandler,
    NotificationHandler,
    SocketGateway,
  ],
  exports: [NotificationHandler],
})
export class NotificationHandlersModule implements OnModuleInit {
  constructor(
    private readonly eventsHandlerService: NotificationHandler,
    private readonly graphEventHandler: GraphNotificationHandler,
    private readonly checkpointerEventHandler: CheckpointerNotificationHandler,
  ) {}

  async onModuleInit() {
    this.eventsHandlerService.registerHandler(this.graphEventHandler);
    this.eventsHandlerService.registerHandler(this.checkpointerEventHandler);

    await this.eventsHandlerService.init();
  }
}
