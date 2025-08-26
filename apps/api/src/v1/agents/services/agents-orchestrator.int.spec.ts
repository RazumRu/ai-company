import { HumanMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { RuntimeType } from '../../runtime/runtime.types';
import { RuntimeOrchestrator } from '../../runtime/services/runtime-orchestrator';
import { AgentOrchestrator } from './agents-orchestrator';

// Integration test for AgentOrchestrator. Skips if Docker not available.
describe('AgentOrchestrator (integration)', () => {
  let agentOrchestrator: AgentOrchestrator;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AgentOrchestrator, RuntimeOrchestrator],
    }).compile();

    agentOrchestrator = module.get(AgentOrchestrator);
  }, 60_000);

  it('creates an agent orchestrator instance successfully', () => {
    expect(agentOrchestrator).toBeDefined();
    expect(agentOrchestrator).toBeInstanceOf(AgentOrchestrator);
  });

  describe('Easy Task Completion Tests', () => {
    it('can complete a simple file creation task', async () => {
      const task = new HumanMessage({
        content:
          'Create a simple "hello world" JavaScript file called hello.js that prints "Hello, World!" to the console',
      });

      const result = await agentOrchestrator.buildAndRunDeveloperGraph(task, {
        runtimeImage: environment.dockerRuntimeImage,
        runtimeType: RuntimeType.Docker,
      });

      console.log(result);
      expect(result).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);

      // Check that we have a title and description from the research phase
      expect(result.title).toBeDefined();
      expect(typeof result.title).toBe('string');
      expect(result.title!.length).toBeGreaterThan(0);

      expect(result.description).toBeDefined();
      expect(typeof result.description).toBe('string');
      expect(result.description!.length).toBeGreaterThan(0);

      // Check that we have a developer work summary
      expect(result.developerWorkSummary).toBeDefined();
      expect(typeof result.developerWorkSummary).toBe('string');
      expect(result.developerWorkSummary!.length).toBeGreaterThan(0);

      // Verify the workflow includes both research and development phases
      const hasResearcherMessage = result.messages.some(
        (msg) => 'name' in msg && msg.name === 'Researcher',
      );
      const hasDeveloperMessage = result.messages.some(
        (msg) => 'name' in msg && msg.name === 'Developer',
      );

      expect(hasResearcherMessage).toBe(true);
      expect(hasDeveloperMessage).toBe(true);
    }, 120_000);
  });
});
