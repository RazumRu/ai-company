import { IAppBootstrapperExtension } from '@packages/common';

import { AuthModule } from './auth.module';
import { IAuthModuleParams } from './auth.types';
import { AuthContextService } from './auth-context.service';

export { AuthContextService, AuthModule };
export * from './auth.types';
export * from './decorators/context-data.decorator';
export * from './decorators/only-for-auth.decorator';
export * from './providers/keycloak.provider';
export * from './providers/auth0.provider';
export * from './providers/auth.provider';
export * from './providers/logto.provider';

export const buildAuthExtension = (
  params: IAuthModuleParams,
): IAppBootstrapperExtension => {
  return {
    modules: [AuthModule.forRoot(params)],
  };
};
