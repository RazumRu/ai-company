import { BadRequestException } from '@packages/common';

import { RuntimeErrorCode, RuntimeInstanceStatus } from '../runtime.types';
import { STATUS_TRANSITIONS } from './runtime-state-machine';

function hasErrorCode(error: unknown): error is { code?: string } {
  return typeof error === 'object' && error !== null;
}

export function assertTransition(
  from: RuntimeInstanceStatus,
  to: RuntimeInstanceStatus,
): void {
  if (from === to) {
    return;
  }
  const allowed = STATUS_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new BadRequestException('INVALID_RUNTIME_STATUS_TRANSITION', {
      from,
      to,
    });
  }
}

export function classifyError(err: unknown): RuntimeErrorCode {
  if (!err) {
    return RuntimeErrorCode.Unknown;
  }
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const lower = message.toLowerCase();

  if (
    /\b(image|manifest|pull|registry|repository does not exist)\b/.test(lower)
  ) {
    return RuntimeErrorCode.ImagePull;
  }
  if (
    /\b(unauthorized|forbidden|access denied|invalid token|credentials?)\b/.test(
      lower,
    )
  ) {
    return RuntimeErrorCode.ProviderAuth;
  }
  if (/\b(timeout|timed out|deadline|exceeded)\b/.test(lower)) {
    return RuntimeErrorCode.Timeout;
  }
  if (
    /\b(socket|econnrefused|enotfound|etimedout|network|dns|eai_again|connect)\b/.test(
      lower,
    ) ||
    (hasErrorCode(err) &&
      (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND'))
  ) {
    return RuntimeErrorCode.RuntimeIo;
  }
  return RuntimeErrorCode.Unknown;
}
