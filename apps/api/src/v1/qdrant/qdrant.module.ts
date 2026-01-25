import { Module } from '@nestjs/common';

import { QdrantService } from './services/qdrant.service';

@Module({
  providers: [QdrantService],
  exports: [QdrantService],
})
export class QdrantModule {}
