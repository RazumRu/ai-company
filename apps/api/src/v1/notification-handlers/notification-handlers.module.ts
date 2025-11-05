import { Module, OnModuleInit } from '@nestjs/common';

import { GraphsModule } from '../graphs/graphs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ThreadsModule } from '../threads/threads.module';
import { SocketGateway } from './gateways/socket.gateway';
import { AgentInvokeNotificationHandler } from './services/event-handlers/agent-invoke-notification-handler';
import { AgentMessageNotificationHandler } from './services/event-handlers/agent-message-notification-handler';
import { AgentStateUpdateNotificationHandler } from './services/event-handlers/agent-state-update-notification-handler';
import { GraphNodeUpdateNotificationHandler } from './services/event-handlers/graph-node-update-notification-handler';
import { GraphNotificationHandler } from './services/event-handlers/graph-notification-handler';
import { ThreadUpdateNotificationHandler } from './services/event-handlers/thread-update-notification-handler';
import { NotificationHandler } from './services/notification-handler.service';

@Module({
  imports: [GraphsModule, NotificationsModule, ThreadsModule],
  providers: [
    GraphNotificationHandler,
    AgentMessageNotificationHandler,
    AgentInvokeNotificationHandler,
    AgentStateUpdateNotificationHandler,
    GraphNodeUpdateNotificationHandler,
    ThreadUpdateNotificationHandler,
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
    private readonly agentStateUpdateEventHandler: AgentStateUpdateNotificationHandler,
    private readonly threadUpdateEventHandler: ThreadUpdateNotificationHandler,
    private readonly graphNodeUpdateEventHandler: GraphNodeUpdateNotificationHandler,
  ) {}

  async onModuleInit() {
    this.eventsHandlerService.registerHandler(this.graphEventHandler);
    this.eventsHandlerService.registerHandler(this.agentMessageEventHandler);
    this.eventsHandlerService.registerHandler(this.agentInvokeEventHandler);
    this.eventsHandlerService.registerHandler(
      this.agentStateUpdateEventHandler,
    );
    this.eventsHandlerService.registerHandler(this.threadUpdateEventHandler);
    this.eventsHandlerService.registerHandler(this.graphNodeUpdateEventHandler);

    await this.eventsHandlerService.init();
  }
}
