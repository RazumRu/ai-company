/**
 * Storybook harness: Thread Cost Playback
 *
 * Streams synthetic fixture messages through the real `sumUsage` aggregation
 * path (the same function used by `useChatsUsageStats` > `selectedThreadAggregateUsage`).
 * This makes "jumping numbers" and "$0.000 after done" symptoms reproducible in
 * isolation without a live backend or Keycloak context.
 *
 * Scenarios:
 *   A — all priced, running→done (monotonic accumulation to $0.125)
 *   B — mixed priced + unpriced (known partial + hasUnpricedCalls flag)
 *   C — all unpriced (renders $— throughout)
 */

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

import type { ThreadTokenUsageSnapshot } from '../../chats/types/index';
import { formatUsd, sumUsage } from '../../chats/utils/chatsPageUtils';
import {
  scenarioAFixtures,
  scenarioBFixtures,
  scenarioCFixtures,
} from './thread-cost-playback.fixtures';
import { useFakeMessageStream } from './useFakeMessageStream';

/* -------------------------------------------------------------------------- */
/*  Layout helpers (mirrors page.tsx Section / Row)                           */
/* -------------------------------------------------------------------------- */

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-16 scroll-mt-8">
      <h2 className="mb-1 text-xl font-semibold">{title}</h2>
      {description && (
        <p className="mb-6 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  CostHeader — mirrors the header cost display in production                */
/* -------------------------------------------------------------------------- */

function CostHeader({
  usage,
  running,
}: {
  usage: ThreadTokenUsageSnapshot | undefined;
  running: boolean;
}) {
  const totalPrice = usage?.totalPrice;
  const hasUnpricedCalls = usage?.hasUnpricedCalls === true;
  const totalTokens = usage?.totalTokens ?? 0;
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;

  const priceLabel = formatUsd(totalPrice);
  const statusLabel = running ? 'running' : 'done';

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted/40 px-4 py-3 font-mono text-sm">
      <span className="text-lg font-semibold tabular-nums">{priceLabel}</span>
      {hasUnpricedCalls && totalPrice === null && (
        <Badge variant="secondary" className="text-xs">
          unpriced model
        </Badge>
      )}
      {hasUnpricedCalls && totalPrice !== null && (
        <Badge variant="secondary" className="text-xs">
          + unpriced calls
        </Badge>
      )}
      <span className="text-muted-foreground">
        {totalTokens.toLocaleString()} tokens ({inputTokens.toLocaleString()} in
        / {outputTokens.toLocaleString()} out)
      </span>
      <Badge variant={running ? 'default' : 'outline'} className="text-xs">
        {statusLabel}
      </Badge>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  MessageFeed — scrollable list of streamed messages                        */
/* -------------------------------------------------------------------------- */

function MessageFeed({
  messages,
}: {
  messages: { id: string; message: { role: string; content?: unknown } }[];
}) {
  return (
    <div className="max-h-48 overflow-y-auto rounded border bg-background p-2">
      {messages.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          Waiting for first message…
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {messages.map((msg) => {
            const content =
              typeof msg.message.content === 'string'
                ? msg.message.content
                : JSON.stringify(msg.message.content);
            return (
              <li key={msg.id} className="flex gap-2 text-xs">
                <span className="w-12 shrink-0 font-medium text-muted-foreground">
                  {msg.message.role}
                </span>
                <span className="truncate">{content}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  ScenarioPlayer                                                            */
/* -------------------------------------------------------------------------- */

type ScenarioKey = 'A' | 'B' | 'C';

const FIXTURE_MAP = {
  A: scenarioAFixtures,
  B: scenarioBFixtures,
  C: scenarioCFixtures,
} as const;

function ScenarioPlayer({ scenario }: { scenario: ScenarioKey }) {
  const [delayMs, setDelayMs] = useState<number>(300);

  // Cast to ThreadMessageDto[] — the fixture type is compatible but uses a
  // widened totalPrice. useFakeMessageStream only reads the array for playback;
  // cost aggregation is done below via sumUsage which accepts the wider shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fixture = FIXTURE_MAP[scenario] as any[];

  const { messages, running, restart } = useFakeMessageStream(fixture, delayMs);

  // Aggregate cost from accumulated messages — same logic as production's
  // selectedThreadAggregateUsage (sumUsage over per-node snapshots, which in
  // turn accumulates from WS token-usage events per message).
  const usage: ThreadTokenUsageSnapshot | undefined = messages.length
    ? sumUsage(
        messages.map((msg) => {
          const ru = msg.requestTokenUsage as
            | {
                inputTokens?: number;
                outputTokens?: number;
                totalTokens?: number;
                totalPrice?: number | null;
              }
            | null
            | undefined;
          if (!ru) {
            return {};
          }
          const snap: ThreadTokenUsageSnapshot = {
            inputTokens: ru.inputTokens,
            outputTokens: ru.outputTokens,
            totalTokens: ru.totalTokens,
            totalPrice: ru.totalPrice === undefined ? undefined : ru.totalPrice,
            hasUnpricedCalls: ru.totalPrice === null,
          };
          return snap;
        }),
      )
    : undefined;

  const handleDelayChange = (values: number[]) => {
    setDelayMs(values[0] ?? 300);
  };

  return (
    <div className="flex flex-col gap-3">
      <CostHeader usage={usage} running={running} />
      <MessageFeed messages={messages} />
      <div className="flex items-center gap-4">
        <Button size="sm" variant="outline" onClick={restart}>
          Restart
        </Button>
        <div className="flex flex-1 items-center gap-3">
          <span className="text-xs text-muted-foreground">Delay</span>
          <Slider
            min={100}
            max={1000}
            step={50}
            value={[delayMs]}
            onValueChange={handleDelayChange}
            className="flex-1"
          />
          <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
            {delayMs} ms
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Exported section component                                                */
/* -------------------------------------------------------------------------- */

export function ThreadCostPlaybackSection() {
  return (
    <Section
      id="thread-cost-playback"
      title="Thread Cost Playback"
      description="Replay synthetic thread messages through the real cost pipeline (sumUsage — same aggregation as production). Scenarios reproduce the 'jumping numbers' and '$0.000 after done' symptoms. Use the Restart button and delay slider to diagnose visually.">
      <Row label="Scenario A — all priced, running→done (expected: monotonic accumulation to $0.13)">
        <ScenarioPlayer scenario="A" />
      </Row>
      <Row label="Scenario B — mixed priced + unpriced (expected: known partial sum + '+ unpriced calls' badge)">
        <ScenarioPlayer scenario="B" />
      </Row>
      <Row label="Scenario C — all unpriced (expected: $— throughout, 'unpriced model' badge)">
        <ScenarioPlayer scenario="C" />
      </Row>
    </Section>
  );
}
