import { beforeEach, describe, expect, it } from 'vitest';

import { MockLlmService } from './mock-llm.service';
import { MockLlmNoMatchError, type MockLlmRequest } from './mock-llm.types';
import { applyDefaults } from './mock-llm-defaults';

const buildRequest = (
  overrides: Partial<MockLlmRequest> = {},
): MockLlmRequest => ({
  kind: 'chat',
  model: 'gpt-4',
  messages: [],
  systemMessage: '',
  lastUserMessage: '',
  lastToolResult: null,
  boundTools: [],
  callIndex: 0,
  ...overrides,
});

describe('MockLlmService', () => {
  let svc: MockLlmService;

  beforeEach(() => {
    svc = new MockLlmService();
  });

  it('(a) onChat with specific matcher returns its reply', () => {
    svc.onChat(
      { lastUserMessage: 'hello' },
      { kind: 'text', content: 'world' },
    );
    const reply = svc.match(buildRequest({ lastUserMessage: 'hello' }));
    expect(reply).toEqual({ kind: 'text', content: 'world' });
  });

  it('(b) most-specific matcher wins among overlapping fixtures', () => {
    // Register general first — without specificity-based resolution, registration
    // order alone would cause the general matcher to win. Registering specific
    // second proves that higher specificity overrides registration order.
    svc.onChat({}, { kind: 'text', content: 'general' });
    svc.onChat({ hasTools: ['shell'] }, { kind: 'text', content: 'specific' });
    const reply = svc.match(buildRequest({ boundTools: ['shell'] }));
    expect(reply).toMatchObject({ content: 'specific' });
  });

  it('(c) FIFO queueChat entries are consumed before fixtures', () => {
    svc.onChat({}, { kind: 'text', content: 'fixture' });
    svc.queueChat({ kind: 'text', content: 'queued' });

    // First call drains the queue entry.
    expect(svc.match(buildRequest({ callIndex: 0 }))).toMatchObject({
      content: 'queued',
    });

    // Queue is now empty — second call falls through to the registered fixture.
    expect(svc.match(buildRequest({ callIndex: 1 }))).toMatchObject({
      content: 'fixture',
    });
  });

  it('(d) queueCost(0.6) yields a text reply with totalPrice === 0.6', () => {
    svc.queueCost(0.6);
    const reply = svc.match(buildRequest());
    expect(reply.kind).toBe('text');
    if (reply.kind === 'text') {
      expect(reply.usage?.totalPrice).toBe(0.6);
    }
  });

  it('(e) getRequests returns recorded requests in call order', () => {
    svc.onChat({}, { kind: 'text', content: 'OK' });
    svc.match(buildRequest({ lastUserMessage: 'first', callIndex: 0 }));
    svc.match(buildRequest({ lastUserMessage: 'second', callIndex: 1 }));

    const reqs = svc.getRequests();
    expect(reqs).toHaveLength(2);
    expect(reqs[0]!.lastUserMessage).toBe('first');
    expect(reqs[1]!.lastUserMessage).toBe('second');
  });

  it('(f) reset clears fixtures, queue, and request log', () => {
    svc.onChat({}, { kind: 'text', content: 'OK' });
    svc.queueChat({ kind: 'text', content: 'queued' });
    svc.match(buildRequest({ callIndex: 0 }));
    expect(svc.getRequests()).toHaveLength(1);

    svc.reset();

    expect(svc.getRequests()).toHaveLength(0);
    // No fixtures and no queue after reset — match must throw.
    expect(() => svc.match(buildRequest({ callIndex: 0 }))).toThrow(
      MockLlmNoMatchError,
    );
  });

  it('(g) no match throws MockLlmNoMatchError with diagnostic context', () => {
    expect.assertions(3);
    try {
      svc.match(
        buildRequest({ lastUserMessage: 'unmatched', boundTools: ['shell'] }),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(MockLlmNoMatchError);
      expect((err as Error).message).toContain('unmatched');
      expect((err as Error).message).toContain('shell');
    }
  });

  it('(h) applyDefaults does not override a previously-registered specific fixture', () => {
    // Register the specific fixture first, then let applyDefaults add its catch-alls.
    svc.onChat(
      { lastUserMessage: 'specific' },
      { kind: 'text', content: 'won' },
    );
    applyDefaults(svc);

    const reply = svc.match(buildRequest({ lastUserMessage: 'specific' }));
    expect(reply).toMatchObject({ content: 'won' });
  });

  // ---------------------------------------------------------------------------
  // Adversarial edge-case tests (F→P failing tests authored by attacker pass)
  // ---------------------------------------------------------------------------

  it('(adv-1) hasTools:[] empty array has specificity 1 and beats a catch-all {} when both match', () => {
    // Bug: specificity() counts Object.values(matcher).filter(v => v !== undefined).length
    // An empty array [] is not undefined, so hasTools:[] scores 1 — same as hasTools:['shell'].
    // This means hasTools:[] is treated as MORE specific than {}, so it wins regardless
    // of content, even though it imposes no actual tool constraint (vacuous truth).
    // Expected: a matcher with no constraint ({}) and one with an empty-array constraint
    // (hasTools:[]) should both score 0 specificity, making registration order decide.
    // Actual: hasTools:[] scores 1 and always wins, even when registered AFTER {}.
    svc.onChat({}, { kind: 'text', content: 'catch-all' });
    svc.onChat({ hasTools: [] }, { kind: 'text', content: 'empty-tools' });

    // A request with non-empty bound tools: hasTools:[] matches vacuously (specificity 1).
    // The catch-all {} also matches (specificity 0). Bug: 'empty-tools' wins.
    const replyWithTools = svc.match(
      buildRequest({ boundTools: ['shell', 'finish'] }),
    );
    // Expect the catch-all to win (first-registered, both have "no real constraint").
    // Currently fails: 'empty-tools' wins because [] != undefined → specificity 1.
    expect(replyWithTools).toMatchObject({ content: 'catch-all' });
  });

  it('(adv-2) hasTools:[a,b] loses to hasTools:[a] when both match a request — array length ignored in specificity', () => {
    // Bug: specificity() returns 1 for hasTools:['shell'] AND for hasTools:['shell','finish']
    // (the entire array is one Object.values entry). Registration order breaks the tie,
    // so the FIRST registered fixture wins — even if the SECOND one matches more precisely
    // (requires both tools to be present). A request carrying both 'shell' and 'finish'
    // should prefer the fixture that constrains on both, but the code picks the first-registered.
    svc.onChat(
      { hasTools: ['shell'] },
      { kind: 'text', content: 'one-tool' },
    );
    svc.onChat(
      { hasTools: ['shell', 'finish'] },
      { kind: 'text', content: 'two-tools' },
    );

    // Request has both tools — the two-tool fixture is strictly more constraining
    // (it would NOT match a request with only ['shell']), so it should win.
    const reply = svc.match(
      buildRequest({ boundTools: ['shell', 'finish'] }),
    );
    // Currently fails: 'one-tool' wins (same specificity 1, registered first).
    expect(reply).toMatchObject({ content: 'two-tools' });
  });

  it('(adv-3) hasTools:[] matches requests with non-empty boundTools via vacuous truth — silently widens scope', () => {
    // Bug: hasTools:[] is intended as "no tool constraint" but is evaluated as
    // [].every(name => bound.includes(name)) which is vacuously true for ANY request,
    // including ones that DO have bound tools. Combined with its specificity of 1
    // ([] is not undefined), it will match and BEAT a catch-all {} for requests
    // carrying actual tools — an unexpected scope leak.
    //
    // Concrete hazard: a test registers hasTools:[] to match "no-tool" calls and
    // also registers a separate fixture for a specific tool. The hasTools:[] fixture
    // silently intercepts the tool-call too, causing wrong replies.
    svc.onChat(
      { hasTools: ['shell'] },
      { kind: 'text', content: 'shell-fixture' },
    );
    // hasTools:[] with higher-priority specificity (registered second but still
    // only specificity 1, same as the shell fixture above).
    // Verification: with hasTools:['shell'] specificity=1 and hasTools:[] specificity=1,
    // registration order decides — shell fixture wins for ['shell'] requests.
    //
    // But for a request with [], the hasTools:[] fixture (vacuous truth) matches
    // while the hasTools:['shell'] fixture does NOT match (shell not in []).
    // The vacuous match with specificity 1 is expected to beat a hypothetical {} catch-all.
    //
    // Core failing assertion: hasTools:[] should NOT match requests that have
    // non-empty boundTools unless that empty constraint is deliberately intended as a
    // wildcard (which contradicts the name "hasTools").
    // The fix would be: hasTools:[] should have specificity 0 (equivalent to not setting hasTools)
    // OR: hasTools:[] should only match requests where boundTools is also empty.
    svc.onChat(
      { hasTools: [] },
      { kind: 'text', content: 'no-tools-intended' },
    );
    svc.onChat({}, { kind: 'text', content: 'catch-all' });

    // A request with bound tools ['shell'] — hasTools:['shell'] matches (specificity 1).
    // hasTools:[] also matches vacuously (specificity 1, registered second — loses to first).
    // Catch-all {} (specificity 0) loses to both. Result should be 'shell-fixture'. OK.
    const replyWithShell = svc.match(
      buildRequest({ boundTools: ['shell'] }),
    );
    expect(replyWithShell).toMatchObject({ content: 'shell-fixture' });

    // A request with bound tools ['finish'] — hasTools:['shell'] does NOT match.
    // hasTools:[] DOES match vacuously (specificity 1, beats catch-all at specificity 0).
    // Bug: 'no-tools-intended' wins, even though this request HAS bound tools.
    // A test author registering hasTools:[] intended it only for requests with NO tools,
    // but it silently captures requests with ['finish'] as well.
    const replyWithFinish = svc.match(
      buildRequest({ boundTools: ['finish'] }),
    );
    // Expected: the catch-all {} wins (hasTools:[] should not match ['finish']).
    // Actually failing: 'no-tools-intended' wins because [] is vacuously true.
    expect(replyWithFinish).toMatchObject({ content: 'catch-all' });
  });
});
