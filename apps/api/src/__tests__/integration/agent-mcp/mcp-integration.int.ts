import { ToolRunnableConfig } from '@langchain/core/tools';
import { INestApplication } from '@nestjs/common';
import { BaseException, DefaultLogger } from '@packages/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { FilesystemMcp } from '../../../v1/agent-mcp/services/mcp/filesystem-mcp';
import { JiraMcp } from '../../../v1/agent-mcp/services/mcp/jira-mcp';
import { PlaywrightMcp } from '../../../v1/agent-mcp/services/mcp/playwright-mcp';
import { SimpleAgent } from '../../../v1/agents/services/agents/simple-agent';
import { BaseAgentConfigurable } from '../../../v1/agents/services/nodes/base-node';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphRegistry } from '../../../v1/graphs/services/graph-registry';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import {
  RuntimeStartParams,
  RuntimeType,
} from '../../../v1/runtime/runtime.types';
import { BaseRuntime } from '../../../v1/runtime/services/base-runtime';
import { DockerRuntime } from '../../../v1/runtime/services/docker-runtime';
import { RuntimeThreadProvider } from '../../../v1/runtime/services/runtime-thread-provider';
import { wait } from '../../test-utils';
import { createMockGraphData } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

const FULL_AGENT_NODE_ID = 'agent-1';
const FULL_TRIGGER_NODE_ID = 'trigger-1';

type TestRuntimeThreadProviderParams = {
  runtimeNodeId: string;
  type: RuntimeType;
  runtimeStartParams: RuntimeStartParams;
  graphId: string;
  temporary?: boolean;
};

type RuntimeInitJob = (
  runtime: BaseRuntime,
  cfg: ToolRunnableConfig<BaseAgentConfigurable>,
) => Promise<void>;

class TestRuntimeThreadProvider {
  private readonly params: TestRuntimeThreadProviderParams;
  private readonly runtime: BaseRuntime;
  private readonly initJobsByNodeId = new Map<
    string,
    Map<string, RuntimeInitJob>
  >();

  constructor(params: TestRuntimeThreadProviderParams, runtime: BaseRuntime) {
    this.params = params;
    this.runtime = runtime;
  }

  public getParams(): TestRuntimeThreadProviderParams {
    return this.params;
  }

  public registerJob(executorNodeId: string, id: string, job: RuntimeInitJob) {
    const jobs = this.initJobsByNodeId.get(executorNodeId) ?? new Map();
    jobs.set(id, job);
    this.initJobsByNodeId.set(executorNodeId, jobs);
  }

  public removeExecutor(executorNodeId: string) {
    this.initJobsByNodeId.delete(executorNodeId);
  }

  public async provide(
    _cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<BaseRuntime> {
    return this.runtime;
  }
}

describe('MCP Integration Tests', () => {
  let runtime: DockerRuntime;
  let playwrightRuntime: DockerRuntime;
  let app: INestApplication;
  let graphsService: GraphsService;
  let graphRegistry: GraphRegistry;
  let fullAgentGraphId: string;

  const cleanupGraph = async (graphId: string) => {
    try {
      await graphsService.destroy(graphId);
    } catch (error: unknown) {
      if (
        !(error instanceof BaseException) ||
        (error.errorCode !== 'GRAPH_NOT_FOUND' &&
          error.errorCode !== 'GRAPH_NOT_RUNNING')
      ) {
        console.error(`Failed to cleanup graph ${graphId}:`, error);
      }
    }

    try {
      await graphsService.delete(graphId);
    } catch (error: unknown) {
      if (
        !(error instanceof BaseException) ||
        error.errorCode !== 'GRAPH_NOT_FOUND'
      ) {
        console.error(`Failed to delete graph ${graphId}:`, error);
      }
    }
  };

  const waitForGraphToBeRunning = async (
    graphId: string,
    timeoutMs = 120_000,
  ) => {
    const startedAt = Date.now();

    while (true) {
      const graph = await graphsService.findById(graphId);

      if (graph.status === GraphStatus.Running) {
        return graph;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Graph ${graphId} did not reach running status within ${timeoutMs}ms (current status: ${graph.status})`,
        );
      }

      await wait(1_000);
    }
  };

  beforeAll(async () => {
    runtime = new DockerRuntime({ socketPath: environment.dockerSocket });
    await runtime.start({
      // Alpine + npx occasionally flakes in CI/containers with TAR_ENTRY_ERROR / missing files.
      // Debian-based node image is more stable for npx-based MCP servers.
      image: 'node:20',
      containerName: 'mcp-integration-test',
      recreate: true,
    });

    // Setup NestJS app for full integration tests
    app = await createTestModule();
    graphsService = app.get(GraphsService);
    graphRegistry = app.get(GraphRegistry);
  }, 120_000);

  afterAll(async () => {
    if (fullAgentGraphId) {
      await cleanupGraph(fullAgentGraphId);
    }
    await runtime.stop();
    if (app) {
      await app.close();
    }
  }, 60000);

  const uniqueThreadSubId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const createRuntimeThreadProvider = (runtimeInstance: BaseRuntime) =>
    new TestRuntimeThreadProvider(
      {
        graphId: 'mcp-test-graph',
        runtimeNodeId: 'runtime-node',
        type: RuntimeType.Docker,
        runtimeStartParams: { workdir: '/runtime-workspace' },
        temporary: true,
      },
      runtimeInstance,
    ) as unknown as RuntimeThreadProvider;

  const buildToolConfig = (threadId: string) => ({
    configurable: {
      thread_id: threadId,
    },
  });

  const ensureGraphRunning = async (graphId: string) => {
    const graph = await graphsService.findById(graphId);
    if (graph.status === GraphStatus.Running) return;
    await graphsService.run(graphId);
    await waitForGraphToBeRunning(graphId);
  };

  const createLogger = () =>
    new DefaultLogger({
      environment: 'test',
      appName: 'test',
      appVersion: '1.0.0',
    });

  describe('FilesystemMcp', () => {
    it('should expose read/write tools when readOnly is false', async () => {
      const runtimeThreadProvider = createRuntimeThreadProvider(runtime);
      const mcp = new FilesystemMcp(createLogger());

      await mcp.initialize(
        { readOnly: false },
        runtimeThreadProvider,
        runtime,
        'executor-filesystem',
      );

      const tools = await mcp.discoverTools();

      // Verify read tools are present
      expect(tools.some((t) => t.name === 'list_directory')).toBe(true);
      expect(tools.some((t) => t.name === 'read_text_file')).toBe(true);
      expect(tools.some((t) => t.name === 'search_files')).toBe(true);

      // Verify write tools are also present
      expect(tools.some((t) => t.name === 'write_file')).toBe(true);
      expect(tools.some((t) => t.name === 'edit_file')).toBe(true);
      expect(tools.some((t) => t.name === 'create_directory')).toBe(true);
      expect(tools.some((t) => t.name === 'move_file')).toBe(true);

      await mcp.cleanup();
    }, 60000);

    it('should see files created via runtime shell after setup (no stale filesystem snapshot)', async () => {
      const runtimeThreadProvider = createRuntimeThreadProvider(runtime);
      const mcp = new FilesystemMcp(createLogger());
      await mcp.initialize(
        { readOnly: false },
        runtimeThreadProvider,
        runtime,
        'executor-filesystem',
      );

      const tools = await mcp.discoverTools();

      const listDirTool = tools.find((t) => t.name === 'list_directory');
      const readFileTool = tools.find((t) => t.name === 'read_text_file');

      expect(listDirTool).toBeDefined();
      expect(readFileTool).toBeDefined();

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const dirPath = `/runtime-workspace/mcp-sync-${suffix}`;
      const filePath = `${dirPath}/hello.txt`;
      const fileContent = `hello-${suffix}`;

      const createRes = await runtime.exec({
        cmd: [
          `mkdir -p '${dirPath}'`,
          `printf '%s' '${fileContent}' > '${filePath}'`,
        ],
      });
      expect(createRes.fail).toBe(false);

      const toolConfig = buildToolConfig(uniqueThreadSubId('mcp-fs-list'));
      const listRes = await listDirTool!.invoke({ path: dirPath }, toolConfig);
      expect(listRes.output).toContain('hello.txt');

      const readRes = await readFileTool!.invoke(
        { path: filePath },
        toolConfig,
      );
      expect(readRes.output).toContain(fileContent);

      await mcp.cleanup();
    }, 60000);

    it('should expose only read-only tools when readOnly: true', async () => {
      const runtimeThreadProvider = createRuntimeThreadProvider(runtime);
      const mcp = new FilesystemMcp(createLogger());

      await mcp.initialize(
        { readOnly: true },
        runtimeThreadProvider,
        runtime,
        'executor-filesystem',
      );

      const tools = await mcp.discoverTools();

      // Verify read tools are present
      expect(tools.some((t) => t.name === 'list_directory')).toBe(true);
      expect(tools.some((t) => t.name === 'read_text_file')).toBe(true);
      expect(tools.some((t) => t.name === 'search_files')).toBe(true);

      // Verify write tools are NOT present
      expect(tools.some((t) => t.name === 'write_file')).toBe(false);
      expect(tools.some((t) => t.name === 'edit_file')).toBe(false);
      expect(tools.some((t) => t.name === 'create_directory')).toBe(false);
      expect(tools.some((t) => t.name === 'move_file')).toBe(false);

      await mcp.cleanup();
    }, 60000);
  });

  describe('JiraMcp', () => {
    it('should fail with auth error when token is missing', async () => {
      const mcp = new JiraMcp(createLogger());

      await expect(
        mcp.setup(
          {
            jiraUrl: 'https://example.atlassian.net',
            jiraApiKey: '',
            jiraEmail: 'test@example.com',
          },
          runtime,
        ),
      ).rejects.toThrow(/auth error/i);
    });
  });

  describe('PlaywrightMcp', () => {
    beforeAll(async () => {
      playwrightRuntime = new DockerRuntime({
        socketPath: environment.dockerSocket,
      });
      await playwrightRuntime.start({
        image: 'docker:24.0-dind',
        containerName: 'mcp-playwright-integration-test',
        recreate: true,
        initScript: [
          'mkdir -p /runtime-workspace/playwright',
          'dockerd --host=unix:///var/run/docker.sock > /var/log/dockerd.log 2>&1 &',
          "sh -c 'i=0; while [ $i -lt 120 ]; do docker info >/dev/null 2>&1 && exit 0; i=$((i+1)); sleep 1; done; exit 1'",
        ],
        initScriptTimeoutMs: 300_000,
      });
    }, 300_000);

    afterAll(async () => {
      if (playwrightRuntime) {
        await playwrightRuntime.stop();
      }
    }, 60000);

    const getToolNames = (tools: { name: string }[]) =>
      tools.map((t) => t.name).sort();

    it('should setup and discover tools successfully', async () => {
      const runtimeThreadProvider =
        createRuntimeThreadProvider(playwrightRuntime);
      const mcp = new PlaywrightMcp(createLogger());

      await mcp.initialize(
        {},
        runtimeThreadProvider,
        playwrightRuntime,
        'executor-playwright',
      );

      const tools = await mcp.discoverTools();

      // Tool names may vary by @playwright/mcp version — assert by capability keywords.
      const names = getToolNames(tools);
      expect(names.some((n) => /navigate|goto|open/i.test(n))).toBe(true);
      expect(names.some((n) => /click|tap/i.test(n))).toBe(true);
      expect(names.some((n) => /fill|type|input/i.test(n))).toBe(true);
      expect(names.some((n) => /screenshot|snapshot/i.test(n))).toBe(true);

      await mcp.cleanup();
    }, 120000);

    it('should execute navigate tool successfully', async () => {
      const runtimeThreadProvider =
        createRuntimeThreadProvider(playwrightRuntime);
      const mcp = new PlaywrightMcp(createLogger());

      await mcp.initialize(
        {},
        runtimeThreadProvider,
        playwrightRuntime,
        'executor-playwright',
      );

      const tools = await mcp.discoverTools();
      const navigateTool = tools.find((t) =>
        /navigate|goto|open/i.test(t.name),
      );

      expect(navigateTool).toBeDefined();
      const args = {
        url: 'https://google.com',
      };

      const result = await navigateTool!.invoke(
        args,
        buildToolConfig(uniqueThreadSubId('mcp-playwright-nav')),
      );

      expect(result).toBeDefined();
      expect(result.output).toBeDefined();

      await mcp.cleanup();
    }, 120000);
  });

  describe('Full Agent Integration', () => {
    beforeAll(async () => {
      const graph = await graphsService.create(
        createMockGraphData({
          schema: {
            nodes: [
              {
                id: 'runtime-1',
                template: 'docker-runtime',
                config: { runtimeType: 'Docker' },
              },
              {
                id: 'mcp-1',
                template: 'filesystem-mcp',
                config: {
                  readOnly: false,
                },
              },
              {
                id: FULL_AGENT_NODE_ID,
                template: 'simple-agent',
                config: {
                  instructions: 'Base agent instructions',
                },
              },
              {
                id: FULL_TRIGGER_NODE_ID,
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [
              { from: FULL_AGENT_NODE_ID, to: 'mcp-1' },
              { from: 'mcp-1', to: 'runtime-1' },
              { from: FULL_TRIGGER_NODE_ID, to: FULL_AGENT_NODE_ID },
            ],
          },
        }),
      );
      fullAgentGraphId = graph.id;

      await graphsService.run(fullAgentGraphId);
      await waitForGraphToBeRunning(fullAgentGraphId);
    }, 180_000);

    it(
      'should inject all MCP tools into agent and expose them in node metadata',
      { timeout: 180_000 },
      async () => {
        await ensureGraphRunning(fullAgentGraphId);

        // Verify MCP tools are available in metadata immediately after graph creation (BEFORE execution)
        const nodesBeforeRun = await graphsService.getCompiledNodes(
          fullAgentGraphId,
          {},
        );
        const agentNodeBeforeRun = nodesBeforeRun.find(
          (n) => n.id === FULL_AGENT_NODE_ID,
        );
        const metadataBeforeRun =
          agentNodeBeforeRun?.additionalNodeMetadata as {
            connectedTools?: {
              name?: string;
              description?: string;
              schema?: unknown;
            }[];
          };

        expect(metadataBeforeRun?.connectedTools).toBeDefined();
        const readFileTool = metadataBeforeRun?.connectedTools?.find(
          (t) => t.name === 'read_text_file',
        );
        expect(readFileTool).toBeDefined();

        // Execute the trigger to run the agent (just to trigger graph build)
        const execution = await graphsService.executeTrigger(
          fullAgentGraphId,
          FULL_TRIGGER_NODE_ID,
          {
            messages: ['Hello'],
            threadSubId: uniqueThreadSubId('mcp-tools-test'),
            async: false,
          },
        );

        // Get node state and verify MCP tools are in metadata
        const nodes = await graphsService.getCompiledNodes(fullAgentGraphId, {
          threadId: execution.externalThreadId,
        });

        const agentNode = nodes.find((n) => n.id === FULL_AGENT_NODE_ID);
        expect(agentNode).toBeDefined();

        const metadata = agentNode?.additionalNodeMetadata as
          | {
              connectedTools?: {
                name?: string;
                description?: string;
                schema?: unknown;
              }[];
            }
          | undefined;

        // Verify connectedTools exists and is an array
        expect(metadata?.connectedTools).toBeDefined();
        expect(Array.isArray(metadata?.connectedTools)).toBe(true);
        expect(metadata!.connectedTools!.length).toBeGreaterThan(0);

        // Verify filesystem MCP tools are present
        const expectedMcpTools = [
          'read_text_file',
          'write_file',
          'list_directory',
          'create_directory',
          'move_file',
          'search_files',
        ];

        for (const toolName of expectedMcpTools) {
          const tool = metadata?.connectedTools?.find(
            (t) => t?.name === toolName,
          );
          expect(tool).toBeDefined();
          expect(typeof tool?.description).toBe('string');
          expect(tool?.description).not.toBe('');

          // Verify schema is properly serialized
          expect(tool?.schema).toBeDefined();
          expect(typeof tool?.schema).toBe('object');
        }
      },
    );

    it(
      'should include MCP tool instructions in agent configuration',
      { timeout: 60000 },
      async () => {
        await ensureGraphRunning(fullAgentGraphId);

        // Get the agent instance from the registry
        const compiledGraph = graphRegistry.get(fullAgentGraphId);
        const agentNode = compiledGraph?.nodes.get(FULL_AGENT_NODE_ID);
        expect(agentNode).toBeDefined();

        const agent = agentNode?.instance as SimpleAgent;
        expect(agent).toBeDefined();

        const agentConfig = agent.getConfig();

        // Verify the instructions include MCP tool instructions
        expect(agentConfig.instructions).toBeDefined();
        expect(agentConfig.instructions).toContain('Base agent instructions');

        // Check for tool instructions section
        expect(agentConfig.instructions).toContain('## Tool Instructions');
        // Check for at least a couple of filesystem MCP tools (they are exposed as agent tools)
        expect(agentConfig.instructions).toContain('### list_directory');
        expect(agentConfig.instructions).toContain('### read_text_file');

        // MCP-level instructions should also be appended
        expect(agentConfig.instructions).toContain('## MCP Instructions');
        expect(agentConfig.instructions).toContain(
          '### Filesystem MCP (@modelcontextprotocol/server-filesystem)',
        );
      },
    );
  });
});
