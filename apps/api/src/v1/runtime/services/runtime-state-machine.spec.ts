import { BadRequestException } from '@packages/common';
import { describe, expect, it } from 'vitest';

import { RuntimeErrorCode, RuntimeInstanceStatus } from '../runtime.types';
import {
  assertTransition,
  classifyError,
  STATUS_TRANSITIONS,
} from './runtime-state-machine.utils';

describe('runtime state machine', () => {
  describe('assertTransition', () => {
    it('allows every legal transition', () => {
      for (const [from, allowed] of Object.entries(STATUS_TRANSITIONS) as [
        RuntimeInstanceStatus,
        readonly RuntimeInstanceStatus[],
      ][]) {
        for (const to of allowed) {
          expect(() => assertTransition(from, to)).not.toThrow();
        }
      }
    });

    it('treats same-status writes as a no-op', () => {
      for (const status of Object.values(RuntimeInstanceStatus)) {
        expect(() => assertTransition(status, status)).not.toThrow();
      }
    });

    it.each([
      [RuntimeInstanceStatus.Stopped, RuntimeInstanceStatus.Starting],
      [RuntimeInstanceStatus.Stopped, RuntimeInstanceStatus.Running],
      [RuntimeInstanceStatus.Failed, RuntimeInstanceStatus.Running],
      [RuntimeInstanceStatus.Running, RuntimeInstanceStatus.Starting],
      [RuntimeInstanceStatus.Starting, RuntimeInstanceStatus.Stopping],
      [RuntimeInstanceStatus.Starting, RuntimeInstanceStatus.Stopped],
    ])('throws BadRequestException on illegal %s → %s', (from, to) => {
      expect(() => assertTransition(from, to)).toThrow(BadRequestException);
    });
  });

  describe('classifyError', () => {
    it.each([
      [
        'permission denied — invalid credentials',
        RuntimeErrorCode.ProviderAuth,
      ],
      [
        'manifest unknown: repository does not exist',
        RuntimeErrorCode.ImagePull,
      ],
      ['pull access denied for foo/bar', RuntimeErrorCode.ImagePull],
      ['operation timed out after 60000 ms', RuntimeErrorCode.Timeout],
      ['ECONNREFUSED 127.0.0.1:2375', RuntimeErrorCode.RuntimeIo],
      ['something unexpected happened', RuntimeErrorCode.Unknown],
    ])('classifies %p as %s', (message, expected) => {
      expect(classifyError(new Error(message))).toBe(expected);
    });

    it('recognises node errno codes', () => {
      const err = Object.assign(new Error('connect failed'), {
        code: 'ECONNREFUSED',
      });
      expect(classifyError(err)).toBe(RuntimeErrorCode.RuntimeIo);
    });

    it('returns Unknown for nullish input', () => {
      expect(classifyError(null)).toBe(RuntimeErrorCode.Unknown);
      expect(classifyError(undefined)).toBe(RuntimeErrorCode.Unknown);
    });
  });
});
