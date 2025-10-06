import { Module } from '@nestjs/common';

import { GraphTemplatesModule } from '../graph-templates/graph-templates.module';
import { GraphCompiler } from './services/graph-compiler';

@Module({
  imports: [GraphTemplatesModule],
  providers: [GraphCompiler],
  exports: [GraphCompiler],
})
export class GraphsModule {}
