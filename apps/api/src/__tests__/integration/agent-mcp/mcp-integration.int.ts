import { INestApplication } from '@nestjs/common';
import { BaseException, DefaultLogger } from '@packages/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

const FULL_AGENT_NODE_ID = 'agent-1';
const FULL_TRIGGER_NODE_ID = 'trigger-1';

describe('MCP Integration Tests', () => {
  let runtime: DockerRuntime;
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
    it('should expose all tools by default (readOnly: false)', async () => {
      const mcp = new FilesystemMcp(createLogger());

      // Setup without specifying readOnly (should default to false)
      await mcp.setup({ readOnly: false }, runtime);

      const tools = await mcp.discoverTools();
      expect(tools.length).toBeGreaterThan(0);

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

    it('should expose only read-only tools when readOnly: true', async () => {
      const mcp = new FilesystemMcp(createLogger());

      await mcp.setup({ readOnly: true }, runtime);

      const tools = await mcp.discoverTools();
      expect(tools.length).toBeGreaterThan(0);

      // Verify read tools are present
      expect(tools.some((t) => t.name === 'list_directory')).toBe(true);
      expect(tools.some((t) => t.name === 'read_text_file')).toBe(true);
      expect(tools.some((t) => t.name === 'search_files')).toBe(true);

      // Verify write tools are NOT present
      expect(tools.some((t) => t.name === 'write_file')).toBe(false);
      expect(tools.some((t) => t.name === 'edit_file')).toBe(false);
      expect(tools.some((t) => t.name === 'create_directory')).toBe(false);
      expect(tools.some((t) => t.name === 'move_file')).toBe(false);

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
      const mcp = new FilesystemMcp(createLogger());
      await mcp.setup({ readOnly: false }, runtime);

      // Cleanup should not throw
      await expect(mcp.cleanup()).resolves.not.toThrow();

      // Second cleanup should also not throw
      await expect(mcp.cleanup()).resolves.not.toThrow();
    }, 60000);
  });

  describe('JiraMcp', () => {
    it('should fail with auth error when token is missing', async () => {
      const mcp = new JiraMcp(createLogger());

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
                config: {},
              },
              {
                id: FULL_AGENT_NODE_ID,
                template: 'simple-agent',
                config: {
                  instructions: 'Base agent instructions',
                  enforceToolUsage: false,
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
          if (tool?.schema) {
            expect(typeof tool.schema).toBe('object');
            expect((tool.schema as { $schema?: string }).$schema).toBe(
              'http://json-schema.org/draft-07/schema#',
            );
          }
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
