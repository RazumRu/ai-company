import { Module, OnModuleInit } from '@nestjs/common';

import { GraphsModule } from '../graphs/graphs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ThreadsModule } from '../threads/threads.module';
import { SocketGateway } from './gateways/socket.gateway';
import { AgentInvokeNotificationHandler } from './services/event-handlers/agent-invoke-notification-handler';
import { AgentMessageNotificationHandler } from './services/event-handlers/agent-message-notification-handler';
import { GraphNotificationHandler } from './services/event-handlers/graph-notification-handler';
import { NotificationHandler } from './services/notification-handler.service';

@Module({
  imports: [GraphsModule, NotificationsModule, ThreadsModule],
  providers: [
    GraphNotificationHandler,
    AgentMessageNotificationHandler,
    AgentInvokeNotificationHandler,
    NotificationHandler,
    SocketGateway,
  ],
  exports: [NotificationHandler],
})
export class NotificationHandlersModule implements OnModuleInit {
  constructor(
    private readonly eventsHandlerService: NotificationHandler,
    private readonly graphEventHandler: GraphNotificationHandler,
    private readonly agentMessageEventHandler: AgentMessageNotificationHandler,
    private readonly agentInvokeEventHandler: AgentInvokeNotificationHandler,
  ) {}

  async onModuleInit() {
    this.eventsHandlerService.registerHandler(this.graphEventHandler);
    this.eventsHandlerService.registerHandler(this.agentMessageEventHandler);
    this.eventsHandlerService.registerHandler(this.agentInvokeEventHandler);

    await this.eventsHandlerService.init();
  }
}
