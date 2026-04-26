/**
 * Prototype patch installer for integration tests.
 *
 * `installBaseAgentPatch()` replaces `BaseAgent.prototype.buildLLM` with a
 * function that constructs `MockChatOpenAI` backed by the singleton
 * `MockLlmService`. The patch is idempotent and applied once per process.
 * Production code never imports this module, so production behaviour is
 * unaffected.
 */
import { Module } from '@nestjs/common';

import { BaseAgent } from '../../../../v1/agents/services/agents/base-agent';
import { MockChatOpenAI } from './mock-chat-openai';
import { MockLlmService } from './mock-llm.service';
import { getMockLlmService } from './mock-llm-singleton';

@Module({
  providers: [MockLlmService],
  exports: [MockLlmService],
})
export class MockLlmModule {}

// ---------------------------------------------------------------------------
// Prototype patch
// ---------------------------------------------------------------------------

const PATCH_SENTINEL = Symbol.for('geniro.mock-llm.base-agent-patch-installed');

interface PatchableBaseAgentPrototype {
  buildLLM: (model: unknown, params?: unknown) => unknown;
  [PATCH_SENTINEL]?: true;
}

/**
 * Replace `BaseAgent.prototype.buildLLM` with a mock implementation backed
 * by `MockChatOpenAI`. Safe to call multiple times — subsequent calls are
 * no-ops (idempotent via `PATCH_SENTINEL`).
 *
 * The getter reference `getMockLlmService` (not a call) is passed to
 * `MockChatOpenAI` so service resolution is deferred to call time, matching
 * how `MockChatOpenAI`'s constructor is designed.
 */
export function installBaseAgentPatch(): void {
  const proto = (
    BaseAgent as unknown as { prototype: PatchableBaseAgentPrototype }
  ).prototype;

  if (proto[PATCH_SENTINEL]) {
    return;
  }

  proto.buildLLM = function patchedBuildLLM(
    model: unknown,
    params?: unknown,
  ): MockChatOpenAI {
    return new MockChatOpenAI(getMockLlmService, {
      model: String(model),
      params,
    });
  };

  proto[PATCH_SENTINEL] = true;
}
