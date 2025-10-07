import { Module } from '@nestjs/common';

import { GraphTemplatesModule } from '../graph-templates/graph-templates.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GraphCompiler } from './services/graph-compiler';

@Module({
  imports: [GraphTemplatesModule, NotificationsModule],
  providers: [GraphCompiler],
  exports: [GraphCompiler],
})
export class GraphsModule {}
