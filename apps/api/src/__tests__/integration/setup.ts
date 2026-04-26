import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { buildBootstrapper, LogLevel } from '@packages/common';
import {
  AuthContextService,
  buildAuthExtension,
  buildHttpServerExtension,
  KeycloakProvider,
} from '@packages/http-server';
import { buildMetricExtension } from '@packages/metrics';
import { buildMikroOrmExtension } from '@packages/mikroorm';

import { AppModule } from '../../app.module';
import mikroOrmConfig from '../../db/mikro-orm.config';
import { environment } from '../../environments';
import { LitellmService } from '../../v1/litellm/services/litellm.service';
import { OpenaiService } from '../../v1/openai/openai.service';
import {
  installBaseAgentPatch,
  MockLlmModule,
} from './mocks/mock-llm/mock-llm.module';
import { MockLlmService } from './mocks/mock-llm/mock-llm.service';
import {
  getMockLlmService,
  setMockLlmService,
} from './mocks/mock-llm/mock-llm-singleton.utils';
import { MockOpenaiAdapter } from './mocks/mock-llm/mock-openai.adapter';

/**
 * Returns a `MockLlmService`-shaped proxy that resolves method calls to the
 * singleton set by `setMockLlmService`. Using a proxy lets the factory create
 * `MockOpenaiAdapter` at compile time without needing `MockLlmService` to be
 * injected from a different DI scope — the real instance is accessed lazily.
 */
function getMockLlmServiceLazy(): MockLlmService {
  return new Proxy({} as MockLlmService, {
    get(_target, prop) {
      const svc = getMockLlmService();
      const value = (svc as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(svc);
      }
      return value;
    },
  });
}

export const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';

export const createTestModule = async (
  cb?: (testingModule: TestingModuleBuilder) => Promise<TestingModule>,
) => {
  // Patch BaseAgent.prototype.buildLLM to return MockChatOpenAI (idempotent).
  installBaseAgentPatch();

  const testBootstrapper = buildBootstrapper({
    environment: environment.env,
    appName: environment.appName,
    appVersion: environment.tag,
  });

  testBootstrapper.addExtension(
    buildHttpServerExtension({
      globalPrefix: environment.globalPrefix,
      apiDefaultVersion: '1',
      port: environment.port,
      swagger: {
        path: environment.swaggerPath,
      },
      helmetOptions: {
        contentSecurityPolicy: false,
        crossOriginOpenerPolicy: {
          policy: 'unsafe-none',
        },
      },
      fastifyOptions: {
        trustProxy: 'loopback',
      },
    }),
  );

  testBootstrapper.addExtension(
    buildAuthExtension({
      devMode: environment.authDevMode,
      provider: new KeycloakProvider({
        url: environment.keycloakUrl,
        realms: [environment.keycloakRealm],
      }),
    }),
  );

  testBootstrapper.addExtension(buildMetricExtension());

  testBootstrapper.addExtension(buildMikroOrmExtension(mikroOrmConfig));

  testBootstrapper.setupLogger({
    prettyPrint: environment.prettyLog,
    level: environment.logLevel as LogLevel,
    sentryDsn: environment.sentryDsn,
  });

  const m = await Test.createTestingModule({
    imports: [testBootstrapper.buildModule([AppModule]), MockLlmModule],
  })
    .overrideProvider(AuthContextService)
    .useValue({
      checkSub: () => TEST_USER_ID,
      getSub: () => TEST_USER_ID,
      getOrganizationId: () => TEST_ORG_ID,
    })
    // Intercept all LLM calls via MockOpenaiAdapter — mock overrides run before
    // any user-supplied `cb` overrides so tests can still chain further overrides.
    // MockLlmService is injected from the global DI context (strict: false) after
    // compile, but the factory receives it via the LitellmService-only inject to
    // avoid cross-module scope resolution at compile time.
    .overrideProvider(OpenaiService)
    .useFactory({
      inject: [LitellmService],
      factory: (litellm: LitellmService) =>
        new MockOpenaiAdapter(getMockLlmServiceLazy(), litellm),
    });

  const moduleRef = cb ? await cb(m) : await m.compile();

  // Bridge the DI instance to the prototype patch singleton and reset per-test state.
  const mockLlm = moduleRef.get(MockLlmService, { strict: false });
  mockLlm.reset();
  setMockLlmService(mockLlm);

  const adapter = new FastifyAdapter();

  const app = moduleRef.createNestApplication(adapter);
  await app.init();

  return app;
};

export const getMockLlm = (app: INestApplication): MockLlmService =>
  app.get(MockLlmService);
