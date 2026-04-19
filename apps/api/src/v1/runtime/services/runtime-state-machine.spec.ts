import { BadRequestException } from '@packages/common';
import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';

import {
  RuntimeErrorCode,
  RuntimeInstanceStatus,
  RuntimeStartingPhase,
} from '../runtime.types';
import { runtimeMachine, STATUS_TRANSITIONS } from './runtime-state-machine';
import { assertTransition, classifyError } from './runtime-state-machine.utils';

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

  describe('runtimeMachine', () => {
    it('initial state is Starting.PullingImage', () => {
      const actor = createActor(runtimeMachine).start();
      expect(
        actor.getSnapshot().matches({
          [RuntimeInstanceStatus.Starting]: RuntimeStartingPhase.PullingImage,
        }),
      ).toBe(true);
      actor.stop();
    });

    it('advances phase sub-states in order on PHASE_ADVANCE', () => {
      const actor = createActor(runtimeMachine).start();
      const order = [
        RuntimeStartingPhase.ContainerCreated,
        RuntimeStartingPhase.InitScript,
        RuntimeStartingPhase.Ready,
      ];
      for (const phase of order) {
        actor.send({ type: 'PHASE_ADVANCE', phase });
        expect(
          actor
            .getSnapshot()
            .matches({ [RuntimeInstanceStatus.Starting]: phase }),
        ).toBe(true);
      }
      actor.stop();
    });

    it('START_SUCCESS moves Starting → Running', () => {
      const actor = createActor(runtimeMachine).start();
      actor.send({ type: 'START_SUCCESS' });
      expect(actor.getSnapshot().matches(RuntimeInstanceStatus.Running)).toBe(
        true,
      );
      actor.stop();
    });

    it('FAIL moves to Failed from Running', () => {
      const actor = createActor(runtimeMachine).start();
      actor.send({ type: 'START_SUCCESS' });
      actor.send({
        type: 'FAIL',
        errorCode: RuntimeErrorCode.Unknown,
        lastError: 'boom',
      });
      const snap = actor.getSnapshot();
      expect(snap.matches(RuntimeInstanceStatus.Failed)).toBe(true);
      expect(snap.status).toBe('done');
      actor.stop();
    });

    it('Stopped is reached via STOP_REQUEST → STOP_SUCCESS and is final', () => {
      const actor = createActor(runtimeMachine).start();
      actor.send({ type: 'START_SUCCESS' });
      actor.send({ type: 'STOP_REQUEST' });
      expect(actor.getSnapshot().matches(RuntimeInstanceStatus.Stopping)).toBe(
        true,
      );
      actor.send({ type: 'STOP_SUCCESS' });
      const snap = actor.getSnapshot();
      expect(snap.matches(RuntimeInstanceStatus.Stopped)).toBe(true);
      expect(snap.status).toBe('done');
      actor.stop();
    });

    it('ignores illegal events from a terminal state', () => {
      const actor = createActor(runtimeMachine).start();
      actor.send({ type: 'START_SUCCESS' });
      actor.send({
        type: 'FAIL',
        errorCode: RuntimeErrorCode.Unknown,
        lastError: 'boom',
      });
      actor.send({ type: 'START_SUCCESS' });
      expect(actor.getSnapshot().matches(RuntimeInstanceStatus.Failed)).toBe(
        true,
      );
      actor.stop();
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
