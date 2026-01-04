import { describe, expect, it } from 'vitest';

import { ThreadStatus } from '../threads.types';
import { GetThreadsQuerySchema } from './threads.dto';

describe('GetThreadsQuerySchema', () => {
  it('coerces a single statuses query value into an array', () => {
    const parsed = GetThreadsQuerySchema.parse({
      statuses: ThreadStatus.Done,
    });

    expect(parsed.statuses).toEqual([ThreadStatus.Done]);
  });

  it('keeps array statuses as-is', () => {
    const parsed = GetThreadsQuerySchema.parse({
      statuses: [ThreadStatus.Done, ThreadStatus.Running],
    });

    expect(parsed.statuses).toEqual([ThreadStatus.Done, ThreadStatus.Running]);
  });

  it('supports comma-separated statuses', () => {
    const parsed = GetThreadsQuerySchema.parse({
      statuses: `${ThreadStatus.Done},${ThreadStatus.Running}`,
    });

    expect(parsed.statuses).toEqual([ThreadStatus.Done, ThreadStatus.Running]);
  });
});
