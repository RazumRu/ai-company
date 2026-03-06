import { Module } from '@nestjs/common';

import { GitAuthModule } from '../git-auth/git-auth.module';
import { SystemController } from './system.controller';

@Module({
  imports: [GitAuthModule],
  controllers: [SystemController],
})
export class SystemModule {}
