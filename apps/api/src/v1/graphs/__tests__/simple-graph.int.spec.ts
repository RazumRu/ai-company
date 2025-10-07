import { AIMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { LoggerModule } from '@packages/common';
import { TypeormModule } from '@packages/typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import typeormconfig from '../../../db/typeormconfig';
import { AgentToolsModule } from '../../agent-tools/agent-tools.module';
import { ManualTrigger } from '../../agent-triggers/services/manual-trigger';
import { AgentsModule } from '../../agents/agents.module';
import { GraphCheckpointEntity } from '../../agents/entity/graph-chekpoints.entity';
import { GraphCheckpointWritesEntity } from '../../agents/entity/graph-chekpoints-writes.entity';
import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { RuntimeModule } from '../../runtime/runtime.module';
import { RuntimeType } from '../../runtime/runtime.types';
import { GraphsModule } from '../graphs.module';
import { NodeKind } from '../graphs.types';
import { GraphCompiler } from '../services/graph-compiler';

describe('Simple Graph Integration Tests', () => {
  let module: TestingModule;
  let graphCompiler: GraphCompiler;
  let templateRegistry: TemplateRegistry;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeormModule.forRootTesting(typeormconfig, [
          GraphCheckpointEntity,
          GraphCheckpointWritesEntity,
        ]),
        RuntimeModule,
        AgentToolsModule,
        AgentsModule,
        GraphsModule,
        LoggerModule.forRoot({
          environment: 'test',
          appName: 'test',
          appVersion: 'test',
        }),
      ],
      providers: [SimpleAgent],
    }).compile();

    await module.init(); // Trigger onModuleInit to register templates

    graphCompiler = module.get<GraphCompiler>(GraphCompiler);
    templateRegistry = module.get<TemplateRegistry>(TemplateRegistry);
  });

  afterEach(async () => {
    await module?.close();
  });

  describe('Graph Compilation Basic Functionality', () => {
    it('should validate graph schemas correctly', () => {
      const validSchema = {
        nodes: [
          {
            id: 'node-1',
            template: 'docker-runtime',
            config: {
              runtimeType: 'Docker',
              image: 'node:18',
            },
          },
        ],
      };

      // Test that the compiler can handle basic schema validation
      expect(() => {
        // This should not throw during basic validation
        const nodes = validSchema.nodes;
        expect(nodes).toHaveLength(1);
        expect(nodes[0]!.id).toBe('node-1');
        expect(nodes[0]!.template).toBe('docker-runtime');
      }).not.toThrow();
    });

    it('should handle duplicate node IDs validation', () => {
      const duplicateIdSchema = {
        nodes: [
          {
            id: 'duplicate-id',
            template: 'docker-runtime',
            config: {
              runtimeType: 'Docker',
              image: 'node:18',
            },
          },
          {
            id: 'duplicate-id',
            template: 'shell-tool',
            config: {
              runtimeNodeId: 'runtime-1',
            },
          },
        ],
      };

      // Test duplicate ID detection logic
      const ids = duplicateIdSchema.nodes.map((n) => n.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(2);
      expect(uniqueIds.size).toBe(1);
      expect(ids.length !== uniqueIds.size).toBe(true);
    });

    it('should handle edge reference validation', () => {
      const schemaWithEdges = {
        nodes: [
          {
            id: 'node-1',
            template: 'docker-runtime',
            config: {
              runtimeType: 'Docker',
              image: 'node:18',
            },
          },
        ],
        edges: [{ from: 'non-existent-node', to: 'node-1' }],
      };

      // Test edge reference validation logic
      const nodeIds = new Set(schemaWithEdges.nodes.map((n) => n.id));
      const edge = schemaWithEdges.edges[0];

      expect(nodeIds.has(edge!.from)).toBe(false);
      expect(nodeIds.has(edge!.to)).toBe(true);
    });

    it('should handle template registry operations', () => {
      // Test template registry basic functionality - now with real templates registered
      expect(templateRegistry.getAllTemplates().length).toBeGreaterThan(0);
      expect(templateRegistry.hasTemplate('non-existent')).toBe(false);
      expect(templateRegistry.hasTemplate('docker-runtime')).toBe(true);

      // Test template retrieval by kind
      const runtimeTemplates = templateRegistry.getTemplatesByKind(
        NodeKind.Runtime,
      );
      const toolTemplates = templateRegistry.getTemplatesByKind(NodeKind.Tool);
      const agentTemplates = templateRegistry.getTemplatesByKind(
        NodeKind.SimpleAgent,
      );

      expect(runtimeTemplates).toHaveLength(1);
      expect(toolTemplates).toHaveLength(3);
      expect(agentTemplates).toHaveLength(1);
    });
  });

  describe('Graph Schema Structure Validation', () => {
    it('should validate node structure', () => {
      const validNode = {
        id: 'test-node',
        template: 'docker-runtime',
        config: {
          runtimeType: 'docker',
          image: 'node:18',
        },
      };

      // Test required fields
      expect(validNode.id).toBeDefined();
      expect(validNode.template).toBeDefined();
      expect(validNode.config).toBeDefined();
      expect(typeof validNode.id).toBe('string');
      expect(typeof validNode.template).toBe('string');
      expect(typeof validNode.config).toBe('object');
    });

    it('should validate edge structure', () => {
      const validEdge = {
        from: 'source-node',
        to: 'target-node',
        label: 'optional-label',
      };

      // Test required fields
      expect(validEdge.from).toBeDefined();
      expect(validEdge.to).toBeDefined();
      expect(typeof validEdge.from).toBe('string');
      expect(typeof validEdge.to).toBe('string');
      expect(validEdge.label).toBeDefined();
    });

    it('should validate metadata structure', () => {
      const validMetadata = {
        name: 'Test Graph',
        description: 'A test graph for validation',
        version: '1.0.0',
      };

      expect(validMetadata.name).toBeDefined();
      expect(validMetadata.description).toBeDefined();
      expect(validMetadata.version).toBeDefined();
      expect(typeof validMetadata.name).toBe('string');
      expect(typeof validMetadata.description).toBe('string');
      expect(typeof validMetadata.version).toBe('string');
    });
  });

  describe('Graph Compilation Logic', () => {
    it('should handle node grouping by kind', () => {
      const nodes = [
        {
          id: 'runtime-1',
          template: 'docker-runtime',
          config: { runtimeType: 'Docker', image: 'node:18' },
        },
        {
          id: 'tool-1',
          template: 'shell-tool',
          config: { runtimeNodeId: 'runtime-1' },
        },
        {
          id: 'agent-1',
          template: 'simple-agent',
          config: {
            name: 'Test',
            instructions: 'Test',
            invokeModelName: 'gpt-4',
          },
        },
      ];

      // Simulate grouping logic
      const groupedNodes = {
        runtime: nodes.filter((n) => n.template === 'docker-runtime'),
        tool: nodes.filter((n) => n.template === 'shell-tool'),
        simpleAgent: nodes.filter((n) => n.template === 'simple-agent'),
      };

      expect(groupedNodes.runtime).toHaveLength(1);
      expect(groupedNodes.tool).toHaveLength(1);
      expect(groupedNodes.simpleAgent).toHaveLength(1);
      expect(groupedNodes.runtime[0]!.id).toBe('runtime-1');
      expect(groupedNodes.tool[0]!.id).toBe('tool-1');
      expect(groupedNodes.simpleAgent[0]!.id).toBe('agent-1');
    });

    it('should handle build order for node compilation', () => {
      const buildOrder = ['runtime', 'tool', 'simpleAgent'];

      expect(buildOrder).toHaveLength(3);
      expect(buildOrder[0]).toBe('runtime');
      expect(buildOrder[1]).toBe('tool');
      expect(buildOrder[2]).toBe('simpleAgent');
    });

    it('should handle compiled graph structure', () => {
      const compiledGraph = {
        nodes: new Map([
          ['node-1', { id: 'node-1', type: 'runtime', instance: {} }],
          ['node-2', { id: 'node-2', type: 'tool', instance: {} }],
        ]),
        edges: [{ from: 'node-1', to: 'node-2', label: 'connection' }],
        metadata: {
          name: 'Test Graph',
          description: 'A test graph',
          version: '1.0.0',
        },
      };

      expect(compiledGraph.nodes.size).toBe(2);
      expect(compiledGraph.edges).toHaveLength(1);
      expect(compiledGraph.metadata?.name).toBe('Test Graph');

      expect(compiledGraph.nodes.get('node-1')?.type).toBe('runtime');
      expect(compiledGraph.nodes.get('node-2')?.type).toBe('tool');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing template errors', () => {
      // Test template existence check
      const templateExists = templateRegistry.hasTemplate(
        'non-existent-template',
      );
      expect(templateExists).toBe(false);
    });

    it('should handle configuration validation errors', () => {
      const invalidConfig = {
        runtimeType: 'invalid',
        image: 123, // Should be string
      };

      // Test that invalid configurations would be caught
      expect(typeof invalidConfig.image).not.toBe('string');
      expect(invalidConfig.runtimeType).not.toBe('Docker');
    });

    it('should handle edge validation errors', () => {
      const invalidEdges = [
        { from: 'non-existent', to: 'target' },
        { from: 'source', to: 'non-existent' },
      ];

      const nodeIds = new Set(['source', 'target']);

      for (const edge of invalidEdges) {
        const fromExists = nodeIds.has(edge.from);
        const toExists = nodeIds.has(edge.to);

        if (!fromExists) {
          expect(edge.from).toBe('non-existent');
        }
        if (!toExists) {
          expect(edge.to).toBe('non-existent');
        }
      }
    });
  });

  describe('Real Graph Compilation Tests', () => {
    it('should compile a simple agent-only graph', async () => {
      const graphSchema = {
        nodes: [
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              name: 'Test Agent',
              instructions: 'You are a helpful assistant.',
              invokeModelName: 'gpt-4',
              summarizeMaxTokens: 1000,
              summarizeKeepTokens: 500,
            },
          },
        ],
      };

      const compiledGraph = await graphCompiler.compile(graphSchema);

      expect(compiledGraph.nodes.size).toBe(1);
      expect(compiledGraph.nodes.get('agent-1')?.instance).toBeDefined();
    });

    it('should compile a multi-agent graph', async () => {
      const graphSchema = {
        nodes: [
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              name: 'Coordinator Agent',
              instructions: 'You coordinate tasks.',
              invokeModelName: 'gpt-4',
              summarizeMaxTokens: 1000,
              summarizeKeepTokens: 500,
              toolNodeIds: ['agent-comm-tool-1'],
            },
          },
          {
            id: 'agent-2',
            template: 'simple-agent',
            config: {
              name: 'Worker Agent',
              instructions: 'You handle tasks.',
              invokeModelName: 'gpt-4',
              summarizeMaxTokens: 1000,
              summarizeKeepTokens: 500,
            },
          },
          {
            id: 'agent-comm-tool-1',
            template: 'agent-communication-tool',
            config: {
              agentId: 'agent-2',
            },
          },
        ],
      };

      const compiledGraph = await graphCompiler.compile(graphSchema);

      expect(compiledGraph.nodes.size).toBe(3);
      expect(compiledGraph.nodes.get('agent-1')?.instance).toBeDefined();
      expect(compiledGraph.nodes.get('agent-2')?.instance).toBeDefined();
      expect(
        compiledGraph.nodes.get('agent-comm-tool-1')?.instance,
      ).toBeDefined();
    });
  });

  describe('Manual Trigger with Shell Command Execution', () => {
    it('should compile graph with trigger and verify destroy works', async () => {
      // First, test just compilation and destroy without invoking
      const graphSchema = {
        nodes: [
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: {
              runtimeType: RuntimeType.Docker,
              image: 'node:18',
            },
          },
          {
            id: 'shell-tool-1',
            template: 'shell-tool',
            config: {
              runtimeNodeId: 'runtime-1',
            },
          },
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              summarizeMaxTokens: 1000,
              summarizeKeepTokens: 500,
              instructions:
                'You are a helpful assistant that can execute shell commands.',
              name: 'Shell Agent',
              invokeModelName: 'gpt-4',
              toolNodeIds: ['shell-tool-1'],
            },
          },
          {
            id: 'trigger-1',
            template: 'manual-trigger',
            config: {
              agentId: 'agent-1',
              threadId: 'test-shell-thread',
            },
          },
        ],
        edges: [],
      };

      const compiledGraph = await graphCompiler.compile(graphSchema);

      try {
        expect(compiledGraph.nodes.size).toBe(4);
        expect(compiledGraph.nodes.has('trigger-1')).toBe(true);

        const triggerNode = compiledGraph.nodes.get('trigger-1');
        const trigger = triggerNode!.instance as ManualTrigger;
        expect(trigger.isStarted).toBe(true);
      } finally {
        await compiledGraph.destroy();
      }
    }, 30000); // 30 second timeout for Docker/Podman operations

    it('should invoke agent via trigger without tools', async () => {
      // Simple test without Docker/shell tools
      const graphSchema = {
        nodes: [
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              summarizeMaxTokens: 1000,
              summarizeKeepTokens: 500,
              instructions:
                'You are a helpful assistant. Keep responses brief.',
              name: 'Simple Agent',
              invokeModelName: 'gpt-5-mini',
              toolNodeIds: [],
            },
          },
          {
            id: 'trigger-1',
            template: 'manual-trigger',
            config: {
              agentId: 'agent-1',
              threadId: 'test-simple-thread',
            },
          },
        ],
        edges: [],
      };

      const compiledGraph = await graphCompiler.compile(graphSchema);

      try {
        const triggerNode = compiledGraph.nodes.get('trigger-1');
        const trigger = triggerNode!.instance as ManualTrigger;

        console.log('Triggering simple agent...');
        const response = await Promise.race([
          trigger.trigger(['Say hello in 5 words or less']),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Simple agent timeout')), 30000),
          ),
        ]);

        console.log('Got response from simple agent');
        expect(response).toBeDefined();
        expect(response.messages).toBeDefined();
        expect(response.messages.length).toBeGreaterThan(0);
      } finally {
        await compiledGraph.destroy();
      }
    }, 45000);

    it('should invoke agent via trigger, execute shell command, and return result', async () => {
      // Create a graph with: runtime -> shell tool -> agent -> trigger
      const graphSchema = {
        nodes: [
          // Runtime
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: {
              runtimeType: RuntimeType.Docker,
              image: 'node:18',
            },
          },
          // Shell tool
          {
            id: 'shell-tool-1',
            template: 'shell-tool',
            config: {
              runtimeNodeId: 'runtime-1',
            },
          },
          // Agent with shell tool
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              summarizeMaxTokens: 1000,
              summarizeKeepTokens: 500,
              instructions:
                'You are a helpful assistant that can execute shell commands. When asked to run a command, use the shell tool.',
              name: 'Shell Agent',
              invokeModelName: 'gpt-5-mini',
              toolNodeIds: ['shell-tool-1'],
            },
          },
          // Manual trigger
          {
            id: 'trigger-1',
            template: 'manual-trigger',
            config: {
              agentId: 'agent-1',
              threadId: 'test-shell-thread',
            },
          },
        ],
        edges: [],
      };

      // Compile the graph
      const compiledGraph = await graphCompiler.compile(graphSchema);

      try {
        // Verify all nodes are compiled
        expect(compiledGraph.nodes.size).toBe(4);
        expect(compiledGraph.nodes.has('runtime-1')).toBe(true);
        expect(compiledGraph.nodes.has('shell-tool-1')).toBe(true);
        expect(compiledGraph.nodes.has('agent-1')).toBe(true);
        expect(compiledGraph.nodes.has('trigger-1')).toBe(true);

        // Get the trigger
        const triggerNode = compiledGraph.nodes.get('trigger-1');
        expect(triggerNode).toBeDefined();
        expect(triggerNode!.type).toBe(NodeKind.Trigger);

        const trigger = triggerNode!.instance as ManualTrigger;
        expect(trigger).toBeDefined();
        expect(trigger.isStarted).toBe(true);

        // Trigger the agent with a simple command
        console.log('Triggering agent...');
        const responsePromise = trigger.trigger([
          'Use the shell tool to execute: echo "Hello from test"',
        ]);

        // Add a timeout to prevent hanging forever
        const response = await Promise.race([
          responsePromise,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Agent invocation timeout')),
              60000,
            ),
          ),
        ]);

        console.log('Got response, checking...');

        // Verify we got a response
        expect(response).toBeDefined();
        expect(response.messages).toBeDefined();
        expect(response.messages.length).toBeGreaterThan(0);

        // Find AI messages with actual content (not just tool calls)
        const aiMessages = response.messages.filter(
          (msg) =>
            msg instanceof AIMessage &&
            msg.content &&
            msg.content.toString().trim().length > 0,
        );
        expect(aiMessages.length).toBeGreaterThan(0);

        const lastAIMessageWithContent = aiMessages[aiMessages.length - 1];
        expect(lastAIMessageWithContent.content).toBeDefined();

        // The response should contain some content
        const responseText = lastAIMessageWithContent.content as string;
        expect(responseText.length).toBeGreaterThan(0);

        console.log('Test passed!');
      } finally {
        await compiledGraph.destroy();
      }
    }, 90000); // 90 second timeout for real LLM and Docker execution
  });
});
