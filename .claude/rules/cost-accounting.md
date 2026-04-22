# Cost Accounting & Numeric Aggregation

Rules for any code that tracks, aggregates, or displays LLM usage costs, token counts, durations, or other measurements.

## Isolated-leaf agent model

- Every agent computes ONLY its own cost. An agent's own cost INCLUDES calls it makes to subagents and communication tools — from the parent's point of view, a subagent is just another tool.
- Subagent accumulators start at `0` on every invocation. Do NOT seed a subagent's `totalPrice` from the parent's state. Do NOT subtract a parent seed from the subagent's reported own-spend.
- The parent's `ToolExecutorNode` spreads the returned `statistics.usage` (including `totalPrice`) into parent state via the standard reducer. That's how the parent's `totalPrice` naturally accumulates subagent costs.
- Cost-limit enforcement is the parent's responsibility. The parent's tool-executor checks `(state.totalPrice + threadUsage.totalPrice >= effectiveLimit)` before invoking the next tool. Subagents run unbounded once invoked; the worst-case overshoot is one subagent's total cost.

## Type shape

- `totalPrice` is `number | undefined` everywhere — DTO, WebSocket event, state, accumulator. Never `number | null`.
- At ingestion (`LitellmService.extractTokenUsageFromResponse`), coerce unknown pricing to `0`: `providerCost ?? calculatedPrice ?? 0`. Unpriced-model handling is operational (register the model via `litellm.yaml` alias + restart LiteLLM) — not a type-system problem.
- Do NOT introduce `hasPricedCall` / `hasUnpricedCalls` / `hasUnknownContributors` companion flags. They clutter the pipeline without adding signal; if a cost reads `$0.000`, that is either genuine `$0` spend (unlikely for a real call) OR an unregistered model — both are fixable at the LiteLLM YAML layer.

## Dual-source aggregation — document the policy

- When two pipelines compute the same aggregate (checkpoint snapshot vs message-scan, WS aggregate vs REST snapshot, cache vs source-of-truth), the service MUST have a docstring-level policy specifying which source is authoritative FOR WHICH FIELDS IN WHICH STATE.
- The current policy in `ThreadsService.getThreadUsageStatistics`: message-scan is authoritative for all additive fields; checkpoint is authoritative only for `currentContext` (point-in-time, can't be reconstructed from messages).
- Removing a `Math.max` / `Math.min` / `value ?? fallback` reconciliation requires a replacement policy. The reconciliation may have been silently fixing the "authoritative source empty, secondary populated" case — removing it without a `primary ?? secondary` fallback regresses that cohort.
- Tests MUST cover the "authoritative source empty" case explicitly. Fixtures that only populate both sources pass regardless of the fallback being present.

## Test matrix requirements

Every change to cost-aggregation or display flow MUST cover at minimum:

| Scenario | Backend test | Frontend test |
|---|---|---|
| All calls priced, running | ✓ | ✓ |
| All calls priced, done | ✓ | ✓ |
| Checkpoint empty, messages populated | ✓ | — (consequence visible) |
| Running→done transition with fresh REST fetch | — | ✓ |
| Thread-switch during running state | — | ✓ |

## Storybook harness

Cost-display components SHOULD have a storybook fixture that replays a recorded sequence of thread messages with configurable delays, running through the same `ThreadMessagesView` + `useChatsUsageStats` path used in production. This is how intermittent "numbers jumping" bugs become visible in isolation.