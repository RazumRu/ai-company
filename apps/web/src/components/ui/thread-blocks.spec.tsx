// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks for heavy/non-essential deps ─────────────────────────────────

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('../markdown/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="markdown-content">{content}</div>
  ),
}));

vi.mock('./syntax-highlighter', () => ({
  SyntaxHighlighter: ({ children }: { children: React.ReactNode }) => (
    <code>{children}</code>
  ),
}));

vi.mock('./json-view', () => ({
  JsonViewer: () => <div data-testid="json-viewer" />,
}));

vi.mock('./agent-avatar', () => ({
  AgentAvatar: () => <div data-testid="agent-avatar" />,
  getAgentInitials: (name: string) => name.slice(0, 2).toUpperCase(),
}));

vi.mock('ansi_up', () => ({
  AnsiUp: class {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- mocking external library API shape (real ansi_up uses snake_case method names)
    ansi_to_html(text: string) {
      return text;
    }
  },
}));

vi.mock('dompurify', () => ({
  default: { sanitize: (html: string) => html },
}));

import React from 'react';

import {
  CommunicationBlock,
  ReasoningBlock,
  StatFooter,
  SubagentBlock,
} from './thread-blocks';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Produces a content string longer than the 130-char isLong threshold. */
const LONG_CONTENT =
  'This is a very detailed piece of reasoning that goes on for quite a long time and exceeds one hundred and thirty characters easily.';

/** Short content — stays under 130 chars. */
const SHORT_CONTENT = 'Brief reasoning.';

// ── Shared teardown ────────────────────────────────────────────────────────────

// Ensure each test starts with a clean DOM, regardless of auto-cleanup timing.
afterEach(() => {
  cleanup();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ReasoningBlock — streaming branch', () => {
  // ── Test 1: streaming + long content, default (collapsed) ─────────────────

  it('renders clamp container + "Show more" button when streaming with long content (collapsed by default)', () => {
    const { container } = render(
      <ReasoningBlock content={LONG_CONTENT} isStreaming />,
    );

    // Clamp container must be present within this render's container
    const clampContainer = container.querySelector(
      '.overflow-hidden.max-h-\\[2lh\\]',
    );
    expect(clampContainer).not.toBeNull();

    // The paragraph with content must be inside the clamp container
    const paragraph = clampContainer?.querySelector('p');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.textContent).toBe(LONG_CONTENT);

    // Show more button must be present
    const showMoreBtn = screen.getByRole('button', { name: /show more/i });
    expect(showMoreBtn).toBeInTheDocument();

    // "reasoning…" label must be visible
    expect(screen.getByText('reasoning…')).toBeInTheDocument();
  });

  // ── Test 2: clicking "Show more" expands content ──────────────────────────

  it('expands content and shows "Show less" after clicking "Show more"', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ReasoningBlock content={LONG_CONTENT} isStreaming />,
    );

    const showMoreBtn = screen.getByRole('button', { name: /show more/i });
    await user.click(showMoreBtn);

    // Clamp container must be gone after expand
    const clampContainer = container.querySelector(
      '.overflow-hidden.max-h-\\[2lh\\]',
    );
    expect(clampContainer).toBeNull();

    // The paragraph must be rendered directly (not inside a clamp wrapper)
    const paragraphs = container.querySelectorAll('p');
    const contentParagraph = Array.from(paragraphs).find(
      (p) => p.textContent === LONG_CONTENT,
    );
    expect(contentParagraph).not.toBeNull();

    // Button must now say "Show less"
    expect(
      screen.getByRole('button', { name: /show less/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });

  // ── Test 3: tail auto-scroll — containerRef.scrollTop === scrollHeight ────

  it('pins scrollTop to scrollHeight of the clamp container (tail auto-scroll)', () => {
    // Stub scrollHeight on HTMLElement.prototype so it returns 100.
    // This must be done before render so the element inherits the override
    // when useLayoutEffect fires (synchronously in act).
    const STUBBED_HEIGHT = 100;
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => STUBBED_HEIGHT,
    });

    let container!: HTMLElement;
    try {
      act(() => {
        ({ container } = render(
          <ReasoningBlock content={LONG_CONTENT} isStreaming />,
        ));
      });

      const clampContainer = container.querySelector(
        '.overflow-hidden.max-h-\\[2lh\\]',
      ) as HTMLElement | null;
      expect(clampContainer).not.toBeNull();

      // useLayoutEffect must have set scrollTop = scrollHeight (= STUBBED_HEIGHT).
      // Verify by reading scrollTop directly off the element.
      expect(clampContainer!.scrollTop).toBe(STUBBED_HEIGHT);
    } finally {
      // Restore original descriptor regardless of test outcome.
      if (originalDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          'scrollHeight',
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
      }
    }
  });

  // ── Test 4: streaming + short content — no clamp, no Show more ───────────

  it('does not render clamp container or "Show more" button for short content', () => {
    const { container } = render(
      <ReasoningBlock content={SHORT_CONTENT} isStreaming />,
    );

    // No clamp container
    const clampContainer = container.querySelector(
      '.overflow-hidden.max-h-\\[2lh\\]',
    );
    expect(clampContainer).toBeNull();

    // No Show more button
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();

    // Content paragraph rendered directly
    const paragraphs = container.querySelectorAll('p');
    const contentParagraph = Array.from(paragraphs).find(
      (p) => p.textContent === SHORT_CONTENT,
    );
    expect(contentParagraph).not.toBeNull();

    // "reasoning…" label still present
    expect(screen.getByText('reasoning…')).toBeInTheDocument();
  });
});

// ── Test 5: non-streaming + long content — existing behavior preserved ────────

describe('ReasoningBlock — non-streaming branch (smoke test)', () => {
  it('applies line-clamp-2 on long content and allows expansion via Show more', async () => {
    const user = userEvent.setup();
    const { container } = render(<ReasoningBlock content={LONG_CONTENT} />);

    // In the non-streaming path, the paragraph carries line-clamp-2 while collapsed
    const clampedParagraph = container.querySelector('p.line-clamp-2');
    expect(clampedParagraph).not.toBeNull();
    expect(clampedParagraph?.textContent).toBe(LONG_CONTENT);

    // Show more button exists
    const showMoreBtn = screen.getByRole('button', { name: /show more/i });
    expect(showMoreBtn).toBeInTheDocument();

    // Click expands — line-clamp-2 must be removed
    await user.click(showMoreBtn);
    const stillClamped = container.querySelector('p.line-clamp-2');
    expect(stillClamped).toBeNull();

    // Button switches to Show less
    expect(
      screen.getByRole('button', { name: /show less/i }),
    ).toBeInTheDocument();
  });
});

// ── StatFooter — subagentRollup annotation ────────────────────────────────────

describe('StatFooter — subagentRollup annotation', () => {
  const baseTokens = {
    total: 647200,
    cost: '$0.536',
    duration: '7m 58s',
  };

  it('renders unchanged output when no subagentRollup is provided', () => {
    const { container } = render(<StatFooter tokens={baseTokens} />);
    // No "total" word on the primary line
    expect(container.textContent).not.toMatch(/\btotal\b/i);
    // No "incl." footnote
    expect(container.textContent).not.toContain('incl.');
  });

  it('renders "total" on the primary line and incl. footnote when count is 3', () => {
    render(
      <StatFooter
        tokens={baseTokens}
        subagentRollup={{ count: 3, cost: 0.234 }}
      />,
    );
    // "total" word must appear
    expect(screen.getByText('total')).toBeInTheDocument();
    // Footnote line must include "incl. 3 subagents"
    const footnote = screen.getByText(/incl\.\s+3 subagents/);
    expect(footnote).toBeInTheDocument();
    // USD amount must appear in the footnote
    expect(footnote.textContent).toContain('$0.234');
  });

  it('uses singular "subagent" when count is 1', () => {
    render(
      <StatFooter
        tokens={baseTokens}
        subagentRollup={{ count: 1, cost: 0.045 }}
      />,
    );
    const footnote = screen.getByText(/incl\.\s+1 subagent/);
    expect(footnote).toBeInTheDocument();
    // Must NOT say "subagents"
    expect(footnote.textContent).not.toContain('subagents');
  });

  it('suppresses sub-line and "total" word when count is 0 (defensive)', () => {
    const { container } = render(
      <StatFooter tokens={baseTokens} subagentRollup={{ count: 0, cost: 0 }} />,
    );
    expect(container.textContent).not.toMatch(/\btotal\b/i);
    expect(container.textContent).not.toContain('incl.');
  });

  it('renders incl. line with formatted cost when cost is defined', () => {
    render(
      <StatFooter
        tokens={baseTokens}
        subagentRollup={{ count: 2, cost: 0.08 }}
      />,
    );
    const footnote = screen.getByText(/incl\.\s+2 subagents/);
    expect(footnote.textContent).toContain('$0.080');
  });

  it('suppresses footnote when cost is undefined (post C-HIGH-1 fix)', () => {
    render(
      <StatFooter
        tokens={baseTokens}
        subagentRollup={{ count: 2, cost: undefined }}
      />,
    );
    // Footnote line must be absent — showing "$—" would be misleading
    expect(screen.queryByText(/incl\./)).toBeNull();
    // "total" suffix on the primary line must still appear — it is a count signal
    expect(screen.getByText('total')).toBeInTheDocument();
  });

  it('all-priced regression guard: footnote IS present with formatted cost', () => {
    render(
      <StatFooter
        tokens={baseTokens}
        subagentRollup={{ count: 2, cost: 0.0183 }}
      />,
    );
    expect(screen.getByText(/incl\.\s+2 subagents/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.018/)).toBeInTheDocument();
  });
});

// ── SubagentBlock — nested subagent footer annotation ─────────────────────────

describe('SubagentBlock — nested subagent footer annotation (consumer mode)', () => {
  it('forwards subagentRollup to StatFooter and renders the annotation', () => {
    render(
      <SubagentBlock
        status="done"
        statistics={{
          usage: { totalTokens: 50000, totalPrice: 0.536, durationMs: 478000 },
        }}
        subagentRollup={{ count: 3, cost: 0.234 }}>
        <div>inner content</div>
      </SubagentBlock>,
    );
    // "total" word must appear in the footer
    expect(screen.getByText('total')).toBeInTheDocument();
    // Footnote must appear
    expect(screen.getByText(/incl\.\s+3 subagents/)).toBeInTheDocument();
  });

  // Test matrix: "All calls priced, running" — annotation still appears during running state
  it('shows annotation when status is running (all calls priced, running)', () => {
    render(
      <SubagentBlock
        status="running"
        statistics={{
          usage: { totalTokens: 20000, totalPrice: 0.18, durationMs: 60000 },
        }}
        subagentRollup={{ count: 2, cost: 0.09 }}>
        <div>inner content</div>
      </SubagentBlock>,
    );
    expect(screen.getByText('total')).toBeInTheDocument();
    expect(screen.getByText(/incl\.\s+2 subagents/)).toBeInTheDocument();
  });

  // Test matrix: "Subagent without cost data" — footnote suppressed, "total" suffix preserved
  it('SubagentBlock: footnote suppressed when subagent cost is undefined; "total" suffix still shows', () => {
    render(
      <SubagentBlock
        status="done"
        statistics={{
          usage: { totalTokens: 10000, totalPrice: 0.05, durationMs: 5000 },
        }}
        subagentRollup={{ count: 1, cost: undefined }}>
        <div>inner content</div>
      </SubagentBlock>,
    );
    // Footnote must be absent — showing "$—" would be misleading
    expect(screen.queryByText(/incl\./)).toBeNull();
    // "total" suffix must still appear — it is a count signal
    expect(screen.getByText('total')).toBeInTheDocument();
  });
});

// ── CommunicationBlock — nested subagent footer annotation ────────────────────

describe('CommunicationBlock — nested subagent footer annotation (consumer mode)', () => {
  // Test matrix: "All calls priced, done"
  it('renders annotation with 3 subagents when done', () => {
    render(
      <CommunicationBlock
        status="done"
        statistics={{
          usage: { totalTokens: 647200, totalPrice: 0.536, durationMs: 478000 },
        }}
        subagentRollup={{ count: 3, cost: 0.234 }}>
        <div>inner content</div>
      </CommunicationBlock>,
    );
    expect(screen.getByText('total')).toBeInTheDocument();
    const footnote = screen.getByText(/incl\.\s+3 subagents/);
    expect(footnote).toBeInTheDocument();
    expect(footnote.textContent).toContain('$0.234');
  });

  // Test matrix: "All calls priced, running"
  it('shows annotation when status is running', () => {
    render(
      <CommunicationBlock
        status="running"
        statistics={{
          usage: { totalTokens: 300000, totalPrice: 0.22, durationMs: 120000 },
        }}
        subagentRollup={{ count: 1, cost: 0.045 }}>
        <div>inner content</div>
      </CommunicationBlock>,
    );
    expect(screen.getByText('total')).toBeInTheDocument();
    expect(screen.getByText(/incl\.\s+1 subagent/)).toBeInTheDocument();
  });

  it('does not render annotation when subagentRollup is absent', () => {
    const { container } = render(
      <CommunicationBlock
        status="done"
        statistics={{
          usage: { totalTokens: 10000, totalPrice: 0.05, durationMs: 5000 },
        }}>
        <div>inner content</div>
      </CommunicationBlock>,
    );
    expect(container.textContent).not.toContain('incl.');
    expect(container.textContent).not.toMatch(/\btotal\b/i);
  });
});

// ── SubagentBlock footer token source tests ────────────────────────────────────

describe('SubagentBlock — footer tokens source', () => {
  it('displays statistics totals in footer when statistics is set', () => {
    const { container } = render(
      <SubagentBlock
        status="done"
        statistics={{
          usage: { totalTokens: 12345, totalPrice: 0.053, durationMs: 1000 },
        }}>
        <div>child</div>
      </SubagentBlock>,
    );

    const badge = container.querySelector('[class*="cursor-pointer"]');
    expect(badge).not.toBeNull();
    const badgeText = badge?.textContent ?? '';
    expect(badgeText).toContain('12.3K');
  });

  it('renders genuine 0 totals as "0 ($0.000)" rather than hiding the badge', () => {
    const { container } = render(
      <SubagentBlock
        status="running"
        statistics={{
          usage: { totalTokens: 0, totalPrice: 0, durationMs: 1500 },
        }}>
        <div>child</div>
      </SubagentBlock>,
    );

    const badge = container.querySelector('[class*="cursor-pointer"]');
    expect(badge).not.toBeNull();
    const badgeText = badge?.textContent ?? '';
    expect(badgeText).toContain('0');
    expect(badgeText).toContain('$0.000');
  });

  it('renders no token badge when statistics is absent', () => {
    const { container } = render(
      <SubagentBlock status="done">
        <div>child</div>
      </SubagentBlock>,
    );

    const badge = container.querySelector('[class*="cursor-pointer"]');
    expect(badge).toBeNull();
  });
});

// ── CommunicationBlock — rollup transitions ────────────────────────────────────

describe('CommunicationBlock — rollup transitions', () => {
  /**
   * Matrix row: "Running→done transition with fresh REST fetch"
   *
   * Renders CommunicationBlock in consumer mode with status="running" and a
   * subagentRollup whose cost is undefined (subagents still running). Post
   * C-HIGH-1 fix: footnote is suppressed when cost is undefined; "total" suffix
   * still appears. Then re-renders with a concrete cost and status="done".
   * Asserts the footer now shows the formatted amount.
   */
  it('footer updates from running to done state', () => {
    const statisticsBase = {
      usage: { totalTokens: 50000, totalPrice: 0.45, durationMs: 60000 },
    };

    const { rerender } = render(
      <CommunicationBlock
        status="running"
        statistics={statisticsBase}
        subagentRollup={{ count: 2, cost: undefined }}>
        <div>inner</div>
      </CommunicationBlock>,
    );

    // Running state: cost not yet available — footnote suppressed (post C-HIGH-1 fix)
    expect(screen.queryByText(/incl\./)).toBeNull();
    // "total" suffix still appears as a count signal
    expect(screen.getByText('total')).toBeInTheDocument();

    // Transition to done with concrete cost
    rerender(
      <CommunicationBlock
        status="done"
        statistics={statisticsBase}
        subagentRollup={{ count: 2, cost: 0.234 }}>
        <div>inner</div>
      </CommunicationBlock>,
    );

    // Done state: cost resolved — footer must show formatted USD
    const doneFootnote = screen.getByText(/incl\.\s+2 subagents/);
    expect(doneFootnote).toBeInTheDocument();
    expect(doneFootnote.textContent).toContain('$0.234');
    // Must not show the dash placeholder
    expect(doneFootnote.textContent).not.toContain('$—');
  });
});
