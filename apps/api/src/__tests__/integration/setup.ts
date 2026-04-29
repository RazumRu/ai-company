import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { buildBootstrapper, DefaultLogger, LogLevel } from '@packages/common';
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
import { NotificationsService } from '../../v1/notifications/services/notifications.service';
import { OpenaiService } from '../../v1/openai/openai.service';
import { RuntimeInstanceDao } from '../../v1/runtime/dao/runtime-instance.dao';
import { RuntimeProvider } from '../../v1/runtime/services/runtime-provider';
import {
  installBaseAgentPatch,
  MockLlmModule,
} from './mocks/mock-llm/mock-llm.module';
import { MockLlmService } from './mocks/mock-llm/mock-llm.service';
import { applyDefaults } from './mocks/mock-llm/mock-llm-defaults.utils';
import {
  getMockLlmService,
  setMockLlmService,
} from './mocks/mock-llm/mock-llm-singleton.utils';
import { MockOpenaiAdapter } from './mocks/mock-llm/mock-openai.adapter';
import { MockMcpModule } from './mocks/mock-mcp/mock-mcp.module';
import { MockMcpService } from './mocks/mock-mcp/mock-mcp.service';
import { applyDefaults as applyMockMcpDefaults } from './mocks/mock-mcp/mock-mcp-defaults.utils';
import { installMockMcpPatch } from './mocks/mock-mcp/mock-mcp-patch.utils';
import { setMockMcpService } from './mocks/mock-mcp/mock-mcp-singleton.utils';
import { MockRuntimeModule } from './mocks/mock-runtime/mock-runtime.module';
import { MockRuntimeService } from './mocks/mock-runtime/mock-runtime.service';
import { MockRuntimeProvider } from './mocks/mock-runtime/mock-runtime-provider';

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

export interface CreateTestModuleOptions {
  /**
   * When `true` (default), `RuntimeProvider` is replaced with
   * `MockRuntimeProvider`, so requests for any runtime type (`Docker`,
   * `Daytona`, `K8s`) yield an in-process `MockRuntime` instead of a real
   * container. Set to `false` for the small number of tests that need a real
   * container (e.g. genuine shell-tool execution).
   */
  mockRuntime?: boolean;
  /**
   * When `true` (default), `BaseMcp.prototype.initialize` and `callTool` are
   * patched to route through `MockMcpService`, skipping the `npx` MCP
   * subprocess entirely. Set to `false` to use the real MCP plumbing.
   */
  mockMcp?: boolean;
}

export const createTestModule = async (
  cb?: (testingModule: TestingModuleBuilder) => Promise<TestingModule>,
  options: CreateTestModuleOptions = {},
) => {
  const mockRuntimeEnabled = options.mockRuntime ?? true;
  const mockMcpEnabled = options.mockMcp ?? true;

  // Patch BaseAgent.prototype.buildLLM to return MockChatOpenAI (idempotent).
  installBaseAgentPatch();
  if (mockMcpEnabled) {
    installMockMcpPatch();
  }

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

  const moduleBuilder = Test.createTestingModule({
    imports: [
      testBootstrapper.buildModule([AppModule]),
      MockLlmModule,
      MockMcpModule,
      MockRuntimeModule,
    ],
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

  const m = mockRuntimeEnabled
    ? moduleBuilder.overrideProvider(RuntimeProvider).useFactory({
        inject: [
          RuntimeInstanceDao,
          DefaultLogger,
          NotificationsService,
          MockRuntimeService,
        ],
        factory: (
          dao: RuntimeInstanceDao,
          logger: DefaultLogger,
          ns: NotificationsService,
          mockRuntimeSvc: MockRuntimeService,
        ) => new MockRuntimeProvider(dao, logger, ns, mockRuntimeSvc),
      })
    : moduleBuilder;

  const moduleRef = cb ? await cb(m) : await m.compile();

  // Bridge the DI instance to the prototype patch singleton and reset per-test state.
  const mockLlm = moduleRef.get(MockLlmService, { strict: false });
  mockLlm.reset();
  // Pre-register catch-all chat/finish/embeddings stubs so test files that
  // pre-date the per-test fixture-registration migration don't throw on every
  // LLM call. Migrated tests typically call `mockLlm.reset()` in a beforeEach
  // before registering specific fixtures, which clears these defaults.
  applyDefaults(mockLlm);
  setMockLlmService(mockLlm);

  if (mockMcpEnabled) {
    const mockMcp = moduleRef.get(MockMcpService, { strict: false });
    mockMcp.reset();
    applyMockMcpDefaults(mockMcp);
    setMockMcpService(mockMcp);
  }

  if (mockRuntimeEnabled) {
    moduleRef.get(MockRuntimeService, { strict: false }).reset();
  }

  const adapter = new FastifyAdapter();

  const app = moduleRef.createNestApplication(adapter);
  await app.init();

  return app;
};

export const getMockLlm = (app: INestApplication): MockLlmService =>
  app.get(MockLlmService);
