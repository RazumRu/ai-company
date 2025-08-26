import { HumanMessage } from '@langchain/core/messages';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RuntimeExecResult, RuntimeType } from '../../../runtime/runtime.types';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { DockerRuntime } from '../../../runtime/services/docker-runtime';
import { RuntimeOrchestrator } from '../../../runtime/services/runtime-orchestrator';
import { BaseAgent } from './base-agent';

class TestAgent extends BaseAgent {
  constructor(public runtime: BaseRuntime) {
    super(runtime, 'gpt-5-mini', 'test-agent');
  }

  public instructions(): string {
    return 'You are a helpful test agent. Execute shell commands as requested and provide clear responses.';
  }
}

// Integration test for BaseAgent. Skips if Docker not available.
describe('BaseAgent (integration)', () => {
  const orchestrator = new RuntimeOrchestrator();
  let runtime: DockerRuntime;
  let agent: TestAgent;
  const image = 'alpine:3.19';

  beforeAll(async () => {
    // Get runtime instance and start it
    runtime = orchestrator.getRuntime(RuntimeType.Docker);
    await runtime.start({ image, workdir: '/root' });

    // Create agent and set runtime
    agent = new TestAgent(runtime);
  }, 120_000);

  afterAll(async () => {
    if (runtime) {
      await runtime.stop();
    }
  }, 60_000);

  it('creates an agent instance successfully', () => {
    expect(agent).toBeDefined();
    expect(agent).toBeInstanceOf(TestAgent);
    expect(agent).toBeInstanceOf(BaseAgent);
  });

  it('has shell tool available', () => {
    const tools = agent.tools;
    expect(tools).toBeDefined();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    // Check if shell tool exists
    const shellTool = tools.find((tool) => tool.name === 'shell');
    expect(shellTool).toBeDefined();
    expect(shellTool?.description).toContain('shell commands');
  });

  it('can execute shell commands through the shell tool directly', async () => {
    const tools = agent.tools;
    const shellTool = tools.find((tool) => tool.name === 'shell');

    expect(shellTool).toBeDefined();

    const result: RuntimeExecResult = await shellTool!.invoke({
      cmd: 'echo "Hello from shell tool test"',
    });

    expect(result).toBeDefined();
    expect(result.stdout).toBe('Hello from shell tool test\n');
    expect(result.exitCode).toBe(0);
  }, 60_000);

  it('shell tool handles command failures correctly', async () => {
    const tools = agent.tools;
    const shellTool = tools.find((tool) => tool.name === 'shell');

    expect(shellTool).toBeDefined();

    // Test shell tool with failing command
    const result: RuntimeExecResult = await shellTool!.invoke({
      cmd: 'nonexistent-command',
    });

    expect(result).toBeDefined();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('not found');
  }, 60_000);

  describe('LLM Agent Workflow Tests', () => {
    it('can run user prompt that requires shell command execution', async () => {
      const result = await agent.run([
        new HumanMessage({
          content: 'Please list files in the current directory',
        }),
      ]);

      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);

      const lastMessage = result.messages.pop()!;

      expect(typeof lastMessage.content).toBe('string');
      expect(lastMessage.content).toContain('directory');
    }, 60_000);

    it('can run user prompt with structured output', async () => {
      const result = await agent.completeStructured(
        [
          new HumanMessage({
            content: 'Please write "test" string into result key to output',
          }),
        ],
        z.object({
          result: z.string(),
        }),
      );

      expect(result).toBeDefined();
      expect(result.result).toEqual('test');
    }, 60_000);

    it('maintains conversation state between consecutive runs', async () => {
      // First run - ask about current directory
      const firstResult = await agent.run([
        new HumanMessage({
          content: 'What is the current directory?',
        }),
      ]);

      expect(firstResult.messages).toBeDefined();
      expect(firstResult.messages.length).toBeGreaterThan(0);
      expect(
        firstResult.messages.find((m) =>
          String(m.content).includes('What is the current directory?'),
        ),
      ).toBeTruthy();

      // Second run - refer to previous conversation
      const secondResult = await agent.run([
        new HumanMessage({
          content: 'What did I ask you in my previous question?',
        }),
      ]);

      expect(secondResult.messages).toBeDefined();
      expect(secondResult.messages.length).toBeGreaterThan(0);

      expect(
        secondResult.messages.find((m) =>
          String(m.content).includes('What is the current directory?'),
        ),
      ).toBeTruthy();

      expect(
        secondResult.messages.filter((m) => m.content === agent.instructions())
          .length,
      ).toEqual(1);

      const lastMessage = secondResult.messages.pop()!;
      expect(lastMessage.content).toContain('directory');
    }, 60_000);
  });
});
