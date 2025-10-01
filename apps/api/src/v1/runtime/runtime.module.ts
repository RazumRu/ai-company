import { Module } from '@nestjs/common';

import { RuntimeProvider } from './services/runtime-provider';

@Module({
  imports: [],
  controllers: [],
  providers: [RuntimeProvider],
  exports: [RuntimeProvider],
})
export class RuntimeModule {}
