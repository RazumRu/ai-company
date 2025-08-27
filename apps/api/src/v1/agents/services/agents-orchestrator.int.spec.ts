import { HumanMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { RuntimeType } from '../../runtime/runtime.types';
import { RuntimeOrchestrator } from '../../runtime/services/runtime-orchestrator';
import { AgentWorkflowEvent } from '../agents.types';
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

      const state = await agentOrchestrator.buildAndRunDeveloperGraph(task, {
        runtimeImage: environment.dockerRuntimeImage,
        runtimeType: RuntimeType.Docker,
      });

      expect(state).toBeDefined();
      expect(state.messages).toBeDefined();
      expect(state.messages.length).toBeGreaterThan(0);

      // Check that we have a title and description from the research phase
      expect(state.title).toBeDefined();
      expect(typeof state.title).toBe('string');
      expect(state.title!.length).toBeGreaterThan(0);

      expect(state.description).toBeDefined();
      expect(typeof state.description).toBe('string');
      expect(state.description!.length).toBeGreaterThan(0);

      // Check that we have a developer work summary
      expect(state.developerWorkSummary).toBeDefined();
      expect(typeof state.developerWorkSummary).toBe('string');
      expect(state.developerWorkSummary!.length).toBeGreaterThan(0);

      // Verify the workflow includes both research and development phases
      const hasResearcherMessage = state.messages.some(
        (msg) => 'name' in msg && msg.name === 'Researcher',
      );
      const hasDeveloperMessage = state.messages.some(
        (msg) => 'name' in msg && msg.name === 'Developer',
      );

      expect(hasResearcherMessage).toBe(true);
      expect(hasDeveloperMessage).toBe(true);
    }, 120_000);

    it('can complete a task with gh repo clone', async () => {
      const task = new HumanMessage({
        content:
          'You have a cloned repo from GH. You should install all deps there, then start it and after just return me output',
      });

      const state = await agentOrchestrator.buildAndRunDeveloperGraph(
        task,
        {
          runtimeImage: environment.dockerRuntimeImage,
          runtimeType: RuntimeType.Docker,
          gitRepo: 'https://github.com/RazumRu/backend-coding-challenge.git',
        },
        // async (event: AgentWorkflowEvent) => {
        //   console.log(event);
        // },
      );

      expect(state).toBeDefined();
      expect(state.messages).toBeDefined();
      expect(state.messages.length).toBeGreaterThan(0);

      // Check that we have a title and description from the research phase
      expect(state.title).toBeDefined();
      expect(typeof state.title).toBe('string');
      expect(state.title!.length).toBeGreaterThan(0);

      expect(state.description).toBeDefined();
      expect(typeof state.description).toBe('string');
      expect(state.description!.length).toBeGreaterThan(0);

      // Check that we have a developer work summary
      expect(state.developerWorkSummary).toBeDefined();
      expect(typeof state.developerWorkSummary).toBe('string');
      expect(state.developerWorkSummary!.length).toBeGreaterThan(0);

      // Verify the workflow includes both research and development phases
      const hasResearcherMessage = state.messages.some(
        (msg) => 'name' in msg && msg.name === 'Researcher',
      );
      const hasDeveloperMessage = state.messages.some(
        (msg) => 'name' in msg && msg.name === 'Developer',
      );

      expect(hasResearcherMessage).toBe(true);
      expect(hasDeveloperMessage).toBe(true);
    }, 180_000);
  });
});
