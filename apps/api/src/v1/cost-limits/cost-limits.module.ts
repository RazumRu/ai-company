import { Module } from '@nestjs/common';

import { UserPreferencesModule } from '../user-preferences/user-preferences.module';
import { CostLimitsDao } from './dao/cost-limits.dao';
import { CostLimitResolverService } from './services/cost-limit-resolver.service';

@Module({
  imports: [UserPreferencesModule],
  providers: [CostLimitsDao, CostLimitResolverService],
  exports: [CostLimitResolverService],
})
export class CostLimitsModule {}
