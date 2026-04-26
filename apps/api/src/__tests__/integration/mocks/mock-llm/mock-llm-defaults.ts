// Optional default fixtures preset for MockLlmService.
//
// IMPORTANT: call applyDefaults() AFTER registering per-test specific fixtures.
// The catch-all chat matcher ({}) matches any chat call; if registered first it
// consumes every call before more-specific fixtures get a chance to match.
// Registration order is the tie-breaker when specificity scores are equal.
//
// Strict throw-on-no-match is the framework default. Most tests should NOT call
// applyDefaults() — use it only when a test does not care about LLM specifics
// and just needs a working harness that will not throw on unmatched calls.

import type { MockLlmService } from './mock-llm.service';

/**
 * Register benign default fixtures on `mockLlm` so that unmatched LLM calls
 * do not throw. Must be called **after** all per-test fixtures are registered.
 *
 * Registered fixtures (in order):
 *  1. finish-tool variant: responds with a `finish` tool call when `finish` is
 *     among the bound tools.
 *  2. catch-all text reply: returns `"OK"` for any remaining chat request.
 *  3. deterministic embeddings stub: returns a stable 1536-dim vector derived
 *     from the input string via a simple FNV-1a hash.
 */
export function applyDefaults(mockLlm: MockLlmService): void {
  mockLlm.onChat(
    { hasTools: ['finish'] },
    { kind: 'toolCall', toolName: 'finish', args: { result: 'done' } },
  );

  mockLlm.onChat({}, { kind: 'text', content: 'OK' });

  mockLlm.onEmbeddings(
    {},
    {
      kind: 'embeddings',
      vector: (input: string) => deterministicVector(input),
    },
  );
}

/**
 * Produce a deterministic 1536-dimensional unit-range vector from `input`.
 *
 * Algorithm:
 *  1. Compute an FNV-1a 32-bit hash over the UTF-16 code units of `input`.
 *  2. Normalise the hash to a float seed in [0, 1].
 *  3. Fill each dimension using `Math.sin(seed * 1000 + i * 0.1)`, which spreads
 *     values across [-1, 1] in a stable, deterministic pattern.
 *
 * This is intentionally a stub — it does not produce semantically meaningful
 * embeddings; it only provides a plausible-looking 1536-dim vector so that
 * code paths that consume embeddings do not crash in tests.
 */
function deterministicVector(input: string): number[] {
  const dim = 1536;

  // FNV-1a 32-bit hash — stable seed derived from input content.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const seed = hash / 0xffffffff; // normalise to [0, 1]

  const vec = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    vec[i] = Math.sin(seed * 1000 + i * 0.1);
  }
  return vec;
}
