import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { SubagentsService } from '../../../../subagents/subagents.service';
import { SubagentsToolGroupConfig } from './subagents.types';
import { SubagentsListTool } from './subagents-list.tool';

describe('SubagentsListTool', () => {
  let tool: SubagentsListTool;
  let subagentsService: SubagentsService;

  const makeConfig = (): SubagentsToolGroupConfig => ({
    resolvedAgents: [],
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SubagentsListTool, SubagentsService],
    }).compile();

    tool = module.get<SubagentsListTool>(SubagentsListTool);
    subagentsService = module.get<SubagentsService>(SubagentsService);
  });

  it('should have correct name', () => {
    expect(tool.name).toBe('subagents_list');
  });

  it('should return all subagent definitions', async () => {
    const result = await tool.invoke({}, makeConfig(), {
      configurable: { thread_id: 'thread-1' },
    });

    expect(result.output.agents).toHaveLength(subagentsService.getAll().length);
    expect(result.output.agents[0]).toHaveProperty('id');
    expect(result.output.agents[0]).toHaveProperty('description');
  });

  it('should include explorer and simple agents', async () => {
    const result = await tool.invoke({}, makeConfig(), {
      configurable: { thread_id: 'thread-1' },
    });

    const ids = result.output.agents.map((a) => a.id);
    expect(ids).toContain('explorer');
    expect(ids).toContain('simple');
  });

  it('should not include system prompts in the output', async () => {
    const result = await tool.invoke({}, makeConfig(), {
      configurable: { thread_id: 'thread-1' },
    });

    for (const agent of result.output.agents) {
      expect(agent).not.toHaveProperty('systemPrompt');
      expect(agent).not.toHaveProperty('toolIds');
    }
  });

  it('should set title in message metadata', async () => {
    const result = await tool.invoke({}, makeConfig(), {
      configurable: { thread_id: 'thread-1' },
    });

    expect(result.messageMetadata?.__title).toBe('List subagents');
  });

  it('should build a DynamicStructuredTool', () => {
    const builtTool = tool.build(makeConfig());
    expect(builtTool).toBeDefined();
    expect(builtTool.name).toBe('subagents_list');
    expect(typeof builtTool.invoke).toBe('function');
  });
});
