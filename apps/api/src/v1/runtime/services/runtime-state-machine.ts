import { setup } from 'xstate';

import {
  RuntimeErrorCode,
  RuntimeInstanceStatus,
  RuntimeStartingPhase,
} from '../runtime.types';

export type RuntimeMachineEvent =
  | { type: 'START_SUCCESS' }
  | { type: 'STOP_REQUEST' }
  | { type: 'STOP_SUCCESS' }
  | {
      type: 'FAIL';
      errorCode: RuntimeErrorCode;
      lastError: string;
    }
  | { type: 'PHASE_ADVANCE'; phase: RuntimeStartingPhase };

export const runtimeMachine = setup({
  types: {
    events: {} as RuntimeMachineEvent,
  },
}).createMachine({
  id: 'runtime',
  initial: RuntimeInstanceStatus.Starting,
  states: {
    [RuntimeInstanceStatus.Starting]: {
      initial: RuntimeStartingPhase.PullingImage,
      states: {
        [RuntimeStartingPhase.PullingImage]: {
          on: {
            PHASE_ADVANCE: [
              {
                target: RuntimeStartingPhase.ContainerCreated,
                guard: ({ event }) =>
                  event.phase === RuntimeStartingPhase.ContainerCreated,
              },
              {
                target: RuntimeStartingPhase.InitScript,
                guard: ({ event }) =>
                  event.phase === RuntimeStartingPhase.InitScript,
              },
              {
                target: RuntimeStartingPhase.Ready,
                guard: ({ event }) =>
                  event.phase === RuntimeStartingPhase.Ready,
              },
            ],
          },
        },
        [RuntimeStartingPhase.ContainerCreated]: {
          on: {
            PHASE_ADVANCE: [
              {
                target: RuntimeStartingPhase.InitScript,
                guard: ({ event }) =>
                  event.phase === RuntimeStartingPhase.InitScript,
              },
              {
                target: RuntimeStartingPhase.Ready,
                guard: ({ event }) =>
                  event.phase === RuntimeStartingPhase.Ready,
              },
            ],
          },
        },
        [RuntimeStartingPhase.InitScript]: {
          on: {
            PHASE_ADVANCE: {
              target: RuntimeStartingPhase.Ready,
              guard: ({ event }) => event.phase === RuntimeStartingPhase.Ready,
            },
          },
        },
        [RuntimeStartingPhase.Ready]: {},
      },
      on: {
        START_SUCCESS: RuntimeInstanceStatus.Running,
        FAIL: RuntimeInstanceStatus.Failed,
      },
    },
    [RuntimeInstanceStatus.Running]: {
      on: {
        STOP_REQUEST: RuntimeInstanceStatus.Stopping,
        FAIL: RuntimeInstanceStatus.Failed,
      },
    },
    [RuntimeInstanceStatus.Stopping]: {
      on: {
        STOP_SUCCESS: RuntimeInstanceStatus.Stopped,
        FAIL: RuntimeInstanceStatus.Failed,
      },
    },
    [RuntimeInstanceStatus.Stopped]: {
      type: 'final',
    },
    [RuntimeInstanceStatus.Failed]: {
      type: 'final',
    },
  },
});

export const STATUS_TRANSITIONS: Readonly<
  Record<RuntimeInstanceStatus, readonly RuntimeInstanceStatus[]>
> = {
  [RuntimeInstanceStatus.Starting]: [
    RuntimeInstanceStatus.Running,
    RuntimeInstanceStatus.Failed,
  ],
  [RuntimeInstanceStatus.Running]: [
    RuntimeInstanceStatus.Stopping,
    RuntimeInstanceStatus.Failed,
  ],
  [RuntimeInstanceStatus.Stopping]: [
    RuntimeInstanceStatus.Stopped,
    RuntimeInstanceStatus.Failed,
  ],
  [RuntimeInstanceStatus.Stopped]: [],
  [RuntimeInstanceStatus.Failed]: [],
};
