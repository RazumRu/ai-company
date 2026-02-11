import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { SubAgent } from '../../../../agents/services/agents/sub-agent';
import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { LlmModelsService } from '../../../../litellm/services/llm-models.service';
import { SubagentsService } from '../../../../subagents/subagents.service';
import { ResolvedSubagent } from '../../../../subagents/subagents.types';
import { BuiltAgentTool } from '../../base-tool';
import { SubagentLoopResult } from './subagent-loop-runner.types';
import { SubagentsToolGroupConfig } from './subagents.types';
import { SubagentsRunTaskTool } from './subagents-run-task.tool';

vi.mock('../../../../../environments', () => ({
  environment: {
    llmLargeModel: 'openai/gpt-5.2-fallback',
  },
}));

describe('SubagentsRunTaskTool', () => {
  let tool: SubagentsRunTaskTool;
  let mockSubAgent: SubAgent;
  let mockLlmModelsService: LlmModelsService;

  const defaultCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
    configurable: { thread_id: 'thread-123' },
  };

  const makeCfgWithParentModel = (
    modelName: string,
  ): ToolRunnableConfig<BaseAgentConfigurable> => ({
    configurable: {
      thread_id: 'thread-123',
      caller_agent: {
        getConfig: () => ({ invokeModelName: modelName }),
      } as BaseAgentConfigurable['caller_agent'],
    },
  });

  const makeMockSubTool = (name: string): BuiltAgentTool => {
    return {
      name,
      description: `Mock ${name}`,
      schema: z.object({ command: z.string() }),
      invoke: vi.fn(),
    } as unknown as BuiltAgentTool;
  };

  const makeResolvedAgents = (): ResolvedSubagent[] => {
    const subagentsService = new SubagentsService();
    const toolSets = new Map<string, BuiltAgentTool[]>();
    toolSets.set('shell', [makeMockSubTool('shell')]);
    toolSets.set('shell:read-only', [makeMockSubTool('shell')]);
    toolSets.set('files:read-only', [
      makeMockSubTool('codebase_search'),
      makeMockSubTool('files_read'),
    ]);
    toolSets.set('files:full', [
      makeMockSubTool('codebase_search'),
      makeMockSubTool('files_read'),
      makeMockSubTool('files_write'),
    ]);

    return subagentsService.getAll().map((definition) => ({
      definition,
      tools: definition.toolIds.flatMap((id) => toolSets.get(id) ?? []),
    }));
  };

  const makeConfig = (
    overrides?: Partial<SubagentsToolGroupConfig>,
  ): SubagentsToolGroupConfig => ({
    resolvedAgents: makeResolvedAgents(),
    ...overrides,
  });

  const defaultLoopResult: SubagentLoopResult = {
    result: 'Task completed successfully.',
    statistics: {
      totalIterations: 2,
      toolCallsMade: 1,
      usage: { inputTokens: 200, outputTokens: 50, totalTokens: 250 },
    },
  };

  beforeEach(async () => {
    mockSubAgent = {
      run: vi.fn().mockResolvedValue(defaultLoopResult),
    } as unknown as SubAgent;

    mockLlmModelsService = {
      getSubagentFastModel: vi.fn().mockReturnValue('gpt-5.1-codex-mini'),
    } as unknown as LlmModelsService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubagentsRunTaskTool,
        SubagentsService,
        { provide: SubAgent, useValue: mockSubAgent },
        { provide: LlmModelsService, useValue: mockLlmModelsService },
      ],
    }).compile();

    tool = module.get<SubagentsRunTaskTool>(SubagentsRunTaskTool);
  });

  describe('schema validation', () => {
    it('should validate required fields', () => {
      const valid = {
        agentId: 'explorer',
        task: 'Find files',
        purpose: 'Explore',
      };
      expect(() => tool.validate(valid)).not.toThrow();
    });

    it('should reject missing agentId', () => {
      expect(() =>
        tool.validate({ task: 'Find files', purpose: 'Explore' }),
      ).toThrow();
    });

    it('should default intelligence to fast', () => {
      const parsed = tool.validate({
        agentId: 'explorer',
        task: 'Find files',
        purpose: 'Explore',
      }) as { intelligence: string };
      expect(parsed.intelligence).toBe('fast');
    });
  });

  describe('agent resolution', () => {
    it('should return error for unknown agentId', async () => {
      const result = await tool.invoke(
        {
          agentId: 'nonexistent',
          task: 'Do something',
          intelligence: 'fast',
          purpose: 'Test',
        },
        makeConfig(),
        defaultCfg,
      );

      expect(result.output.error).toBe('Invalid agentId');
      expect(result.output.result).toContain('Unknown agent ID "nonexistent"');
      expect(mockSubAgent.run).not.toHaveBeenCalled();
    });

    it('should resolve explorer agent tools', async () => {
      await tool.invoke(
        {
          agentId: 'explorer',
          task: 'Find files',
          intelligence: 'fast',
          purpose: 'Explore',
        },
        makeConfig(),
        defaultCfg,
      );

      const runCall = vi.mocked(mockSubAgent.run).mock.calls[0];
      const loopConfig = runCall?.[1];
      // Explorer has toolIds: ['shell:read-only', 'files:read-only']
      // shell:read-only = 1 tool, files:read-only = 2 tools
      expect(loopConfig?.tools).toHaveLength(3);
    });

    it('should resolve simple agent tools', async () => {
      await tool.invoke(
        {
          agentId: 'simple',
          task: 'Edit file',
          intelligence: 'fast',
          purpose: 'Edit',
        },
        makeConfig(),
        defaultCfg,
      );

      const runCall = vi.mocked(mockSubAgent.run).mock.calls[0];
      const loopConfig = runCall?.[1];
      // Simple has toolIds: ['shell', 'files:full']
      // shell = 1 tool, files:full = 3 tools
      expect(loopConfig?.tools).toHaveLength(4);
    });
  });

  describe('model selection', () => {
    it('should use fast model by default', async () => {
      await tool.invoke(
        {
          agentId: 'explorer',
          task: 'Find files',
          intelligence: 'fast',
          purpose: 'Explore',
        },
        makeConfig(),
        defaultCfg,
      );

      expect(mockLlmModelsService.getSubagentFastModel).toHaveBeenCalled();
      const runCall = vi.mocked(mockSubAgent.run).mock.calls[0];
      expect(runCall?.[1]?.model).toBe('gpt-5.1-codex-mini');
    });

    it('should use parent agent model when smart is requested', async () => {
      await tool.invoke(
        {
          agentId: 'explorer',
          task: 'Analyze code',
          intelligence: 'smart',
          purpose: 'Deep analysis',
        },
        makeConfig(),
        makeCfgWithParentModel('anthropic/claude-sonnet-4-20250514'),
      );

      const runCall = vi.mocked(mockSubAgent.run).mock.calls[0];
      expect(runCall?.[1]?.model).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('should fall back to default large model when parent agent is unavailable', async () => {
      await tool.invoke(
        {
          agentId: 'explorer',
          task: 'Analyze code',
          intelligence: 'smart',
          purpose: 'Deep analysis',
        },
        makeConfig(),
        defaultCfg,
      );

      const runCall = vi.mocked(mockSubAgent.run).mock.calls[0];
      expect(runCall?.[1]?.model).toBe('openai/gpt-5.2-fallback');
    });

    it('should use smartModelOverride when configured', async () => {
      await tool.invoke(
        {
          agentId: 'explorer',
          task: 'Analyze code',
          intelligence: 'smart',
          purpose: 'Deep analysis',
        },
        makeConfig({ smartModelOverride: 'openai/o3-pro' }),
        makeCfgWithParentModel('anthropic/claude-sonnet-4-20250514'),
      );

      const runCall = vi.mocked(mockSubAgent.run).mock.calls[0];
      expect(runCall?.[1]?.model).toBe('openai/o3-pro');
    });
  });

  describe('system prompt', () => {
    it('should include agent definition system prompt', async () => {
      await tool.invoke(
        {
          agentId: 'explorer',
          task: 'Find files',
          intelligence: 'fast',
          purpose: 'Explore',
        },
        makeConfig(),
        defaultCfg,
      );

      const runCall = vi.mocked(mockSubAgent.run).mock.calls[0];
      expect(runCall?.[1]?.systemPrompt).toContain('explorer subagent');
    });

    it('should append resource information to system prompt', async () => {
      await tool.invoke(
        {
          agentId: 'explorer',
          task: 'Find files',
          intelligence: 'fast',
          purpose: 'Explore',
        },
        makeConfig({ resourcesInformation: '- github-resource: my-repo' }),
        defaultCfg,
      );

      const runCall = vi.mocked(mockSubAgent.run).mock.calls[0];
      expect(runCall?.[1]?.systemPrompt).toContain(
        '- github-resource: my-repo',
      );
    });
  });

  describe('result handling', () => {
    it('should wrap loop result into ToolInvokeResult', async () => {
      const result = await tool.invoke(
        {
          agentId: 'simple',
          task: 'Do work',
          intelligence: 'fast',
          purpose: 'Test',
        },
        makeConfig(),
        defaultCfg,
      );

      expect(result.output.result).toBe('Task completed successfully.');
      expect(result.output.statistics.totalIterations).toBe(2);
      expect(result.output.statistics.toolCallsMade).toBe(1);
      expect(result.toolRequestUsage).toEqual({
        inputTokens: 200,
        outputTokens: 50,
        totalTokens: 250,
      });
    });

    it('should propagate error from loop result', async () => {
      vi.mocked(mockSubAgent.run).mockResolvedValueOnce({
        result: 'Subagent was aborted.',
        statistics: { totalIterations: 1, toolCallsMade: 0, usage: null },
        error: 'Aborted',
      });

      const result = await tool.invoke(
        {
          agentId: 'simple',
          task: 'Do work',
          intelligence: 'fast',
          purpose: 'Test',
        },
        makeConfig(),
        defaultCfg,
      );

      expect(result.output.error).toBe('Aborted');
    });
  });

  describe('title generation', () => {
    it('should generate title with agentId and purpose', async () => {
      const result = await tool.invoke(
        {
          agentId: 'explorer',
          task: 'Find auth deps',
          intelligence: 'fast',
          purpose: 'Map auth deps',
        },
        makeConfig(),
        defaultCfg,
      );

      expect(result.messageMetadata?.__title).toBe(
        'Subagent (explorer): Map auth deps',
      );
    });
  });

  describe('build', () => {
    it('should create a DynamicStructuredTool', () => {
      const builtTool = tool.build(makeConfig());
      expect(builtTool).toBeDefined();
      expect(builtTool.name).toBe('subagents_run_task');
      expect(typeof builtTool.invoke).toBe('function');
    });

    it('should include detailed instructions', () => {
      const builtTool = tool.build(makeConfig());
      expect(builtTool.__instructions).toBeDefined();
      expect(builtTool.__instructions).toContain('subagent');
    });
  });
});
