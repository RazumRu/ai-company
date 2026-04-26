import type { RequestTokenUsage } from '../../../../v1/litellm/litellm.types';

/**
 * Criteria used to match an incoming LLM request against a registered fixture.
 * All fields are optional — undefined fields are treated as wildcards (match anything).
 */
export interface MockLlmMatcher {
  /** Match against the model name. String = equality; RegExp = .test(). */
  model?: string | RegExp;
  /** Match against the last user message content. String = includes; RegExp = .test(). */
  lastUserMessage?: string | RegExp;
  /** Match against the system message. String = includes; RegExp = .test(). */
  systemMessage?: string | RegExp;
  /**
   * Subset match: every name listed here must appear in `request.boundTools`.
   * The request may have additional tools beyond these.
   */
  hasTools?: string[];
  /** Match against the name of the last tool result in the message history. */
  hasToolResult?: string;
  /** Exact match against `request.callIndex` (0-based). */
  callIndex?: number;
}

/**
 * The reply payload that a registered fixture or queued entry returns
 * when a request is matched.
 */
export type MockLlmReply =
  | { kind: 'text'; content: string; usage?: Partial<RequestTokenUsage> }
  | {
      kind: 'toolCall';
      toolName: string;
      args: Record<string, unknown>;
      usage?: Partial<RequestTokenUsage>;
    }
  | { kind: 'json'; content: unknown; usage?: Partial<RequestTokenUsage> }
  | {
      kind: 'embeddings';
      vector: number[] | ((input: string) => number[]);
      usage?: Partial<RequestTokenUsage>;
    }
  | { kind: 'error'; status: number; message: string };

/**
 * A normalised snapshot of a single LLM call recorded by the service.
 * `match()` evaluates matchers against this shape and `getRequests()` returns
 * all accumulated records in call order.
 */
export interface MockLlmRequest {
  /** Broad category of the request. */
  kind: 'chat' | 'json' | 'embeddings';
  /** Model identifier passed by the caller (may be undefined for embeddings). */
  model?: string;
  /** Full message history for chat/json requests. */
  messages?: { role: string; content: string; name?: string }[];
  /** Extracted system message (if any). */
  systemMessage?: string;
  /** Content of the last message with role 'human' / 'user'. */
  lastUserMessage?: string;
  /** The last tool result message in the history, if any. */
  lastToolResult?: { name: string; content: string } | null;
  /** Names of all tools that were bound to the model for this call. */
  boundTools?: string[];
  /** Input text or texts for embedding requests. */
  embeddingInput?: string | string[];
  /** 0-based monotonic counter maintained by the service across all call kinds. */
  callIndex: number;
}

/** A matcher + reply pair registered via `onChat` / `onJsonRequest` / `onEmbeddings`. */
export interface MockLlmFixture {
  matcher: MockLlmMatcher;
  reply: MockLlmReply;
}

/**
 * Thrown by `MockLlmService.match()` when no registered fixture or queued
 * reply matches the incoming request.
 *
 * The `name` property is explicitly set to `'MockLlmNoMatchError'` so that
 * `err.name` checks work across module boundaries even when the class is
 * transpiled or bundled.
 */
export class MockLlmNoMatchError extends Error {
  public readonly request: MockLlmRequest;
  public readonly registeredMatchers: MockLlmMatcher[];

  constructor(opts: {
    request: MockLlmRequest;
    registeredMatchers: MockLlmMatcher[];
  }) {
    const { request, registeredMatchers } = opts;

    const truncate = (s: string | undefined, max: number): string => {
      if (!s) {
        return '(none)';
      }
      return s.length > max ? `${s.slice(0, max)}…` : s;
    };

    const matcherLines =
      registeredMatchers.length > 0
        ? registeredMatchers.map((m) => `    ${JSON.stringify(m)}`).join('\n')
        : '    (none)';

    const message = [
      'MockLlmService: no fixture matched.',
      `  model: ${request.model ?? '(none)'}`,
      `  callIndex: ${request.callIndex}`,
      `  lastUserMessage: ${truncate(request.lastUserMessage, 500)}`,
      `  systemMessage: ${truncate(request.systemMessage, 200)}`,
      `  boundTools: [${(request.boundTools ?? []).join(', ')}]`,
      `  lastToolResult: ${request.lastToolResult?.name ?? 'none'}`,
      `  registered matchers (${registeredMatchers.length}):`,
      matcherLines,
    ].join('\n');

    super(message);
    this.name = 'MockLlmNoMatchError';
    this.request = request;
    this.registeredMatchers = registeredMatchers;
  }
}
