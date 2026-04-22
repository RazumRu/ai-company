# Cost Accounting & Numeric Aggregation

Rules for any code that tracks, aggregates, or displays LLM usage costs, token counts, durations, or other measurements that may legitimately be zero OR legitimately unknown.

## Preserve null through the pipeline

- At ingestion boundaries (e.g. `LitellmService.extractTokenUsageFromResponse`), never coerce unknown pricing/measurement to `0` via `?? 0`. If the upstream returned `null`, propagate `null`.
- `RequestTokenUsage.totalPrice`, any DTO that carries a derived cost, and any schema field for a measurement that can legitimately be unknown MUST be declared nullable (`z.number().nullable()` or equivalent). TypeScript then drives every consumer to handle the null branch.
- Aggregators must skip null contributors AND track a `hasUnpricedCalls: boolean` (or `hasUnknownContributors`) companion flag. Sum-of-known + flag is strictly more informative than coerced-to-zero sum.
- **Every aggregator is in scope — primary and secondary.** A single service method often has a primary accumulator (the returned `total`) PLUS secondary breakdown maps (e.g. `byTool`, `byNode`, `subCalls`, `toolOwnUsage`). Each of these is an aggregator and must apply the same null-skip + companion-flag discipline. A single reviewer pass that audits only the primary path misses the secondary paths, and `|| 0` in a breakdown map silently undoes the null-preservation at the primary level.
- **Test helpers must not coerce null → 0.** Fixture builder functions used by specs that verify null propagation (e.g. `makeUsageStats({ total })`) must pass `totalPrice` through as-is. A `totalPrice: total.totalPrice ?? 0` inside a helper is a false-negative trap: the test can pass even when the production code under test fails to preserve null.
- UI formatters for these fields MUST render null as a visually distinct glyph (`$—`, `N/A`, `unknown`) — never the same visual as a legitimate zero (`$0.0000`).

## Dual-source aggregation — document the policy

- When two pipelines (e.g. checkpoint snapshot vs message-scan, WS aggregate vs REST snapshot, cache vs source-of-truth) compute the same aggregate, the service MUST have a docstring-level policy specifying which source is authoritative FOR WHICH FIELDS IN WHICH STATE.
- Removing a `Math.max` / `Math.min` / `value ?? fallback` reconciliation requires a replacement policy. The reconciliation may have been silently fixing the "authoritative source empty, secondary populated" case — removing it without a `primary ?? secondary` fallback regresses that cohort.
- Tests MUST cover the "authoritative source empty" case explicitly. Fixtures that only populate both sources pass regardless of the fallback being present.

## Test matrix requirements

Every change to cost-aggregation or display flow MUST present a test matrix covering at minimum:

| Scenario | Backend test | Frontend test |
|---|---|---|
| All calls priced, running | ✓ | ✓ |
| All calls priced, done | ✓ | ✓ |
| Mixed priced + unpriced calls | ✓ | ✓ |
| All calls unpriced | ✓ | ✓ |
| Checkpoint empty, messages populated | ✓ | — (consequence visible) |
| Running→done transition with fresh REST fetch | — | ✓ |
| Thread-switch during running state | — | ✓ |

If any row is missing, the PR is incomplete.

**Avoid vacuous assertions.** A test like `if (x !== null) expect(x).toBe(expectedValue)` passes silently when `x` is null — the wrong regression completely slips through. Assert unconditionally: `expect(x).toBeDefined(); expect(x).toBe(expectedValue);`

## Storybook harness

Cost-display components SHOULD have a storybook fixture that replays a recorded sequence of thread messages with configurable delays, running through the same `ThreadMessagesView` + `useChatsUsageStats` path used in production. This is how intermittent "numbers jumping" bugs become visible in isolation.