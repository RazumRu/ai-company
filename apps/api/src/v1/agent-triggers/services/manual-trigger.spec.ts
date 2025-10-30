import { HumanMessage } from '@langchain/core/messages';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOutput } from '../../agents/services/agents/base-agent';
import { TriggerStatus } from '../agent-triggers.types';
import { ManualTrigger } from './manual-trigger';

describe('ManualTrigger', () => {
  let trigger: ManualTrigger;

  beforeEach(() => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as DefaultLogger;
    trigger = new ManualTrigger(mockLogger);
  });

  describe('initialization', () => {
    it('should start with IDLE status', () => {
      expect(trigger.getStatus()).toBe(TriggerStatus.IDLE);
      expect(trigger.isStarted).toBe(false);
    });
  });

  describe('start', () => {
    it('should change status to LISTENING', async () => {
      await trigger.start();

      expect(trigger.getStatus()).toBe(TriggerStatus.LISTENING);
      expect(trigger.isStarted).toBe(true);
    });
  });

  describe('stop', () => {
    it('should change status to DESTROYED', async () => {
      await trigger.start();
      await trigger.stop();

      expect(trigger.getStatus()).toBe(TriggerStatus.DESTROYED);
      expect(trigger.isStarted).toBe(false);
    });
  });

  describe('trigger', () => {
    it('should throw error if not started', async () => {
      await expect(trigger.trigger(['test'])).rejects.toThrow(
        'Trigger is not in listening state',
      );
    });

    it('should throw error if agent invocation not set', async () => {
      await trigger.start();

      await expect(trigger.trigger(['test'])).rejects.toThrow(
        'Agent invocation function not set',
      );
    });

    it('should invoke agent with messages', async () => {
      const mockOutput: AgentOutput = {
        messages: [new HumanMessage('response')],
        threadId: 'test-thread-id',
      };

      const mockInvokeAgent = vi.fn().mockResolvedValue(mockOutput);
      trigger.setInvokeAgent(mockInvokeAgent);

      await trigger.start();
      const result = await trigger.trigger([
        'test message 1',
        'test message 2',
      ]);

      expect(result).toEqual(mockOutput);
      expect(mockInvokeAgent).toHaveBeenCalledTimes(1);

      const [messages, config] = mockInvokeAgent.mock.calls[0] || [];
      expect(messages).toHaveLength(2);
      expect(messages[0]).toBeInstanceOf(HumanMessage);
      expect(messages[0].content).toBe('test message 1');
      expect(messages[1]).toBeInstanceOf(HumanMessage);
      expect(messages[1].content).toBe('test message 2');
      expect(config).toEqual({});
    });

    it('should handle multiple sequential invocations', async () => {
      const mockOutput1: AgentOutput = {
        messages: [new HumanMessage('response 1')],
        threadId: 'test-thread-id-1',
      };
      const mockOutput2: AgentOutput = {
        messages: [new HumanMessage('response 2')],
        threadId: 'test-thread-id-2',
      };

      const mockInvokeAgent = vi
        .fn()
        .mockResolvedValueOnce(mockOutput1)
        .mockResolvedValueOnce(mockOutput2);

      trigger.setInvokeAgent(mockInvokeAgent);
      await trigger.start();

      const result1 = await trigger.trigger(['message 1']);
      const result2 = await trigger.trigger(['message 2']);

      expect(result1).toEqual(mockOutput1);
      expect(result2).toEqual(mockOutput2);
      expect(mockInvokeAgent).toHaveBeenCalledTimes(2);
    });

    it('should maintain LISTENING status after successful invocation', async () => {
      const mockOutput: AgentOutput = {
        messages: [new HumanMessage('response')],
        threadId: 'test-thread-id',
      };

      trigger.setInvokeAgent(vi.fn().mockResolvedValue(mockOutput));
      await trigger.start();
      await trigger.trigger(['test']);

      expect(trigger.getStatus()).toBe(TriggerStatus.LISTENING);
      expect(trigger.isStarted).toBe(true);
    });

    it('should throw error if stopped', async () => {
      const mockOutput: AgentOutput = {
        messages: [new HumanMessage('response')],
        threadId: 'test-thread-id',
      };

      trigger.setInvokeAgent(vi.fn().mockResolvedValue(mockOutput));
      await trigger.start();
      await trigger.stop();

      await expect(trigger.trigger(['test'])).rejects.toThrow(
        'Trigger is not in listening state. Current status: destroyed',
      );
    });
  });

  describe('convertPayloadToMessages', () => {
    it('should convert payload messages to HumanMessage instances', async () => {
      const mockOutput: AgentOutput = {
        messages: [new HumanMessage('response')],
        threadId: 'test-thread-id',
      };

      let capturedMessages: HumanMessage[] = [];
      const mockInvokeAgent = vi.fn((messages) => {
        capturedMessages = messages;
        return Promise.resolve(mockOutput);
      });

      trigger.setInvokeAgent(mockInvokeAgent);
      await trigger.start();
      await trigger.trigger(['msg1', 'msg2', 'msg3']);

      expect(capturedMessages).toHaveLength(3);
      capturedMessages.forEach((msg) => {
        expect(msg).toBeInstanceOf(HumanMessage);
      });
      expect(capturedMessages.map((m) => m.content)).toEqual([
        'msg1',
        'msg2',
        'msg3',
      ]);
    });
  });
});
