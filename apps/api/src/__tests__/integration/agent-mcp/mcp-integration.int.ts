import { INestApplication } from '@nestjs/common';
import { BaseException, DefaultLogger } from '@packages/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { FilesystemMcp } from '../../../v1/agent-mcp/services/mcp/filesystem-mcp';
import { JiraMcp } from '../../../v1/agent-mcp/services/mcp/jira-mcp';
import { SimpleAgent } from '../../../v1/agents/services/agents/simple-agent';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphRegistry } from '../../../v1/graphs/services/graph-registry';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { DockerRuntime } from '../../../v1/runtime/services/docker-runtime';
import { wait } from '../../test-utils';
import { createMockGraphData } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

describe('MCP Integration Tests', () => {
  let runtime: DockerRuntime;
  let app: INestApplication;
  let graphsService: GraphsService;
  let graphRegistry: GraphRegistry;
  const createdGraphIds: string[] = [];

  const registerGraph = (graphId: string) => {
    if (!createdGraphIds.includes(graphId)) {
      createdGraphIds.push(graphId);
    }
  };

  const cleanupGraph = async (graphId: string) => {
    try {
      await graphsService.destroy(graphId);
    } catch (error: unknown) {
      if (
        !(error instanceof BaseException) ||
        error.errorCode !== 'GRAPH_NOT_FOUND'
      ) {
        console.error(`Failed to cleanup graph ${graphId}:`, error);
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
    runtime = new DockerRuntime();
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
  }, 120000);

  afterEach(async () => {
    // Cleanup created graphs
    for (const graphId of createdGraphIds) {
      await cleanupGraph(graphId);
    }
    createdGraphIds.length = 0;
  }, 30000);

  afterAll(async () => {
    await runtime.stop();
    if (app) {
      await app.close();
    }
  }, 60000);

  describe('FilesystemMcp', () => {
    it('should setup, discover tools, and execute', async () => {
      const logger = new DefaultLogger({
        environment: 'test',
        appName: 'test',
        appVersion: '1.0.0',
      });
      const mcp = new FilesystemMcp(logger);

      await mcp.setup({ runtime }, runtime);

      const tools = await mcp.discoverTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'list_directory')).toBe(true);

      // Test tool execution via BuiltAgentTool interface
      const listDirTool = tools.find((t) => t.name === 'list_directory');
      expect(listDirTool).toBeDefined();
      if (listDirTool) {
        const result = await listDirTool.invoke({
          path: '/runtime-workspace',
        });
        expect(result).toBeDefined();
        expect(result.output).toBeDefined();
      }

      await mcp.cleanup();
    }, 60000);

    it('should handle cleanup without errors', async () => {
      const logger = new DefaultLogger({
        environment: 'test',
        appName: 'test',
        appVersion: '1.0.0',
      });
      const mcp = new FilesystemMcp(logger);
      await mcp.setup({ runtime }, runtime);

      // Cleanup should not throw
      await expect(mcp.cleanup()).resolves.not.toThrow();

      // Second cleanup should also not throw
      await expect(mcp.cleanup()).resolves.not.toThrow();
    }, 60000);
  });

  describe('JiraMcp', () => {
    const jiraApiKey = process.env.TEST_JIRA_API_KEY;
    const jiraEmail = process.env.TEST_JIRA_EMAIL;

    it('should fail with auth error when token is missing', async () => {
      const logger = new DefaultLogger({
        environment: 'test',
        appName: 'test',
        appVersion: '1.0.0',
      });
      const mcp = new JiraMcp(logger);

      await expect(
        mcp.setup(
          {
            name: 'test-jira',
            jiraApiKey: '',
            jiraEmail: 'test@example.com',
          },
          runtime,
        ),
      ).rejects.toThrow(/auth error/i);
    });

    const itIf = jiraApiKey && jiraEmail ? it : it.skip;

    itIf(
      'should setup and discover tools',
      async () => {
        const logger = new DefaultLogger({
          environment: 'test',
          appName: 'test',
          appVersion: '1.0.0',
        });
        const mcp = new JiraMcp(logger);

        await mcp.setup(
          {
            name: 'test-jira',
            jiraApiKey: jiraApiKey!,
            jiraEmail: jiraEmail!,
          },
          runtime,
        );

        const tools = await mcp.discoverTools();
        expect(tools.length).toBeGreaterThan(0);

        await mcp.cleanup();
      },
      30000,
    );
  });

  describe('Full Agent Integration', () => {
    it(
      'should inject all MCP tools into agent and expose them in node metadata',
      { timeout: 180_000 },
      async () => {
        const AGENT_NODE_ID = 'agent-1';
        const TRIGGER_NODE_ID = 'trigger-1';

        // Create graph with agent connected to filesystem MCP
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
                  config: {},
                },
                {
                  id: AGENT_NODE_ID,
                  template: 'simple-agent',
                  config: {
                    enforceToolUsage: false,
                  },
                },
                {
                  id: TRIGGER_NODE_ID,
                  template: 'manual-trigger',
                  config: {},
                },
              ],
              edges: [
                { from: AGENT_NODE_ID, to: 'mcp-1' },
                { from: 'mcp-1', to: 'runtime-1' },
                { from: TRIGGER_NODE_ID, to: AGENT_NODE_ID },
              ],
            },
          }),
        );
        registerGraph(graph.id);

        // Run the graph
        await graphsService.run(graph.id);
        await waitForGraphToBeRunning(graph.id);

        // Verify MCP tools are available in metadata immediately after graph creation (BEFORE execution)
        const nodesBeforeRun = await graphsService.getCompiledNodes(
          graph.id,
          {},
        );
        const agentNodeBeforeRun = nodesBeforeRun.find(
          (n) => n.id === AGENT_NODE_ID,
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
        console.log(
          '✓ Verified MCP tools are present in metadata BEFORE execution',
        );

        // Execute the trigger to run the agent (just to trigger graph build)
        const execution = await graphsService.executeTrigger(
          graph.id,
          TRIGGER_NODE_ID,
          {
            messages: ['Hello'],
            threadSubId: 'mcp-tools-test',
            async: false,
          },
        );

        // Wait a bit for the agent to start and build graph (which discovers MCP tools)
        await wait(3000);

        // Get node state and verify MCP tools are in metadata
        const nodes = await graphsService.getCompiledNodes(graph.id, {
          threadId: execution.externalThreadId,
        });

        const agentNode = nodes.find((n) => n.id === AGENT_NODE_ID);
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
          if (tool?.schema) {
            expect(typeof tool.schema).toBe('object');
            expect((tool.schema as { $schema?: string }).$schema).toBe(
              'http://json-schema.org/draft-07/schema#',
            );
          }
        }

        console.log(
          `✓ All ${expectedMcpTools.length} filesystem MCP tools found in agent metadata`,
        );
      },
    );

    it(
      'should include MCP tool instructions in agent configuration',
      { timeout: 60000 },
      async () => {
        const AGENT_NODE_ID = 'agent-1';
        const TRIGGER_NODE_ID = 'trigger-1';

        // Create graph with agent connected to filesystem MCP
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
                  config: {},
                },
                {
                  id: AGENT_NODE_ID,
                  template: 'simple-agent',
                  config: {
                    instructions: 'Base agent instructions',
                    enforceToolUsage: false,
                  },
                },
                {
                  id: TRIGGER_NODE_ID,
                  template: 'manual-trigger',
                  config: {},
                },
              ],
              edges: [
                { from: AGENT_NODE_ID, to: 'mcp-1' },
                { from: 'mcp-1', to: 'runtime-1' },
                { from: TRIGGER_NODE_ID, to: AGENT_NODE_ID },
              ],
            },
          }),
        );
        registerGraph(graph.id);

        // Run the graph to initialize it
        await graphsService.run(graph.id);
        await waitForGraphToBeRunning(graph.id);

        // Get the agent instance from the registry
        const compiledGraph = graphRegistry.get(graph.id);
        const agentNode = compiledGraph?.nodes.get(AGENT_NODE_ID);
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
