import { Module } from '@nestjs/common';

import { NotificationsService } from './services/notifications.service';

@Module({
  imports: [],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
