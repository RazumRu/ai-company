import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  AIMessageDto,
  HumanMessageDto,
  ShellToolMessageDto,
  SystemMessageDto,
  ToolMessageDto,
} from '../dto/graphs.dto';
import { MessageTransformerService } from './message-transformer.service';

describe('MessageTransformerService', () => {
  let service: MessageTransformerService;

  beforeEach(() => {
    service = new MessageTransformerService();
  });

  describe('transformMessageToDto', () => {
    it('should transform human message', () => {
      const msg = new HumanMessage('Hello, world!');

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'human',
        content: 'Hello, world!',
        additionalKwargs: undefined,
      } as HumanMessageDto);
    });

    it('should transform system message', () => {
      const msg = new SystemMessage({
        content: 'System instruction',
        additional_kwargs: { context: 'test' },
      });

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'system',
        content: 'System instruction',
        additionalKwargs: { context: 'test' },
      } as SystemMessageDto);
    });

    it('should transform AI message without tool calls', () => {
      const msg = new AIMessage({
        content: 'AI response',
        id: 'msg-123',
      });

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'ai',
        content: 'AI response',
        id: 'msg-123',
        toolCalls: undefined,
        additionalKwargs: undefined,
      } as AIMessageDto);
    });

    it('should transform AI message with tool calls', () => {
      const msg = new AIMessage({
        content: 'Calling tools',
        id: 'msg-456',
        tool_calls: [
          {
            name: 'get_weather',
            args: { city: 'SF' },
            type: 'tool_call',
            id: 'call-1',
          },
        ],
      });

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'ai',
        content: 'Calling tools',
        id: 'msg-456',
        toolCalls: [
          {
            name: 'get_weather',
            args: { city: 'SF' },
            type: 'tool_call',
            id: 'call-1',
          },
        ],
        additionalKwargs: undefined,
      } as AIMessageDto);
    });

    it('should transform tool message', () => {
      const msg = new ToolMessage({
        content: '{"result": "success"}',
        name: 'web_search',
        tool_call_id: 'call-789',
      });

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'tool',
        name: 'web_search',
        content: { result: 'success' },
        toolCallId: 'call-789',
        additionalKwargs: undefined,
      } as ToolMessageDto);
    });

    it('should transform shell tool message', () => {
      const msg = new ToolMessage({
        content: JSON.stringify({
          exitCode: 0,
          stdout: 'Success',
          stderr: '',
          cmd: 'echo test',
        }),
        name: 'shell',
        tool_call_id: 'call-shell-1',
      });

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'tool-shell',
        name: 'shell',
        content: {
          exitCode: 0,
          stdout: 'Success',
          stderr: '',
          cmd: 'echo test',
        },
        toolCallId: 'call-shell-1',
        additionalKwargs: undefined,
      } as ShellToolMessageDto);
    });

    it('should handle malformed tool content', () => {
      const msg = new ToolMessage({
        content: 'not valid json',
        name: 'test_tool',
        tool_call_id: 'call-1',
      });

      const result = service.transformMessageToDto(msg) as ToolMessageDto;

      expect(result.content).toEqual({ message: 'not valid json' });
    });

    it('should transform serialized human message', () => {
      const serializedMsg = {
        lc: 1,
        type: 'constructor',
        id: ['langchain_core', 'messages', 'HumanMessage'],
        kwargs: {
          content: 'Hello from serialized message!',
          additional_kwargs: {},
        },
      };

      const result = service.transformMessageToDto(serializedMsg);

      expect(result).toEqual({
        role: 'human',
        content: 'Hello from serialized message!',
        additionalKwargs: undefined,
      } as HumanMessageDto);
    });

    it('should transform serialized tool message', () => {
      const serializedMsg = {
        lc: 1,
        type: 'constructor',
        id: ['langchain_core', 'messages', 'ToolMessage'],
        kwargs: {
          tool_call_id: 'call_QrlzvPAGfR5P9k8KgEzt7zgH',
          name: 'shell',
          content: JSON.stringify({
            exitCode: 0,
            stdout: 'Docker info output',
            stderr: 'Some warnings',
            cmd: 'docker info',
            fail: false,
          }),
          additional_kwargs: {},
        },
      };

      const result = service.transformMessageToDto(serializedMsg);

      expect(result).toEqual({
        role: 'tool-shell',
        name: 'shell',
        content: {
          exitCode: 0,
          stdout: 'Docker info output',
          stderr: 'Some warnings',
          cmd: 'docker info',
          fail: false,
        },
        toolCallId: 'call_QrlzvPAGfR5P9k8KgEzt7zgH',
        additionalKwargs: undefined,
      } as ShellToolMessageDto);
    });

    it('should transform serialized AI message with tool calls', () => {
      const serializedMsg = {
        lc: 1,
        type: 'constructor',
        id: ['langchain_core', 'messages', 'AIMessage'],
        kwargs: {
          content: 'I will call a tool',
          id: 'msg-123',
          tool_calls: [
            {
              name: 'get_weather',
              args: { city: 'SF' },
              type: 'tool_call',
              id: 'call-1',
            },
          ],
          additional_kwargs: {},
        },
      };

      const result = service.transformMessageToDto(serializedMsg);

      expect(result).toEqual({
        role: 'ai',
        content: 'I will call a tool',
        id: 'msg-123',
        toolCalls: [
          {
            name: 'get_weather',
            args: { city: 'SF' },
            type: 'tool_call',
            id: 'call-1',
          },
        ],
        additionalKwargs: undefined,
      } as AIMessageDto);
    });

    it('should handle the exact serialized message format from the user issue', () => {
      const serializedMsg = {
        lc: 1,
        type: 'constructor',
        id: ['langchain_core', 'messages', 'ToolMessage'],
        kwargs: {
          tool_call_id: 'call_QrlzvPAGfR5P9k8KgEzt7zgH',
          name: 'shell',
          content:
            '{"exitCode":0,"stdout":"DOCKER_HOST=tcp://dind-rt-5ac512cd-3622-45ef-99bd-cdb9bfc09f03-runtime-1:2375\\nDOCKER_HOST=tcp://dind-rt-5ac512cd-3622-45ef-99bd-cdb9bfc09f03-runtime-1:2375\\nClient:\\n Version:    28.3.3\\n Context:    default\\n Debug Mode: false\\n\\nServer:\\n Containers: 0\\n  Running: 0\\n  Paused: 0\\n  Stopped: 0\\n Images: 0\\n Server Version: 27.5.1\\n Storage Driver: overlay2\\n  Backing Filesystem: xfs\\n  Supports d_type: true\\n  Using metacopy: false\\n  Native Overlay Diff: true\\n  userxattr: false\\n Logging Driver: json-file\\n Cgroup Driver: cgroupfs\\n Cgroup Version: 2\\n Plugins:\\n  Volume: local\\n  Network: bridge host ipvlan macvlan null overlay\\n  Log: awslogs fluentd gcplogs gelf journald json-file local splunk syslog\\n Swarm: inactive\\n Runtimes: io.containerd.runc.v2 runc\\n Default Runtime: runc\\n Init Binary: docker-init\\n containerd version: bcc810d6b9066471b0b6fa75f557a15a1cbf31bb\\n runc version: v1.2.4-0-g6c52b3f\\n init version: de40ad0\\n Security Options:\\n  seccomp\\n   Profile: builtin\\n  cgroupns\\n Kernel Version: 6.12.13-200.fc41.aarch64\\n Operating System: Alpine Linux v3.21 (containerized)\\n OSType: linux\\n Architecture: aarch64\\n CPUs: 4\\n Total Memory: 18.13GiB\\n Name: f2995c57f1be\\n ID: c336402e-b158-4049-a33c-b1433ecc5a91\\n Docker Root Dir: /var/lib/docker\\n Debug Mode: false\\n Experimental: false\\n Insecure Registries:\\n  127.0.0.0/8\\n Live Restore Enabled: false\\n Product License: Community Engine\\n\\n Security Options:\\n  seccomp\\n   Profile: builtin\\n  cgroupns\\n Kernel Version: 6.12.13-200.fc41.aarch64\\n Operating System: Alpine Linux v3.21 (containerized)\\n OSType: linux\\n Architecture: aarch64\\n CPUs: 4\\n Total Memory: 18.13GiB\\n Name: f2995c57f1be\\n ID: c336402e-b158-4049-a33c-b1433ecc5a91\\n Docker Root Dir: /var/lib/docker\\n Debug Mode: false\\n Experimental: false\\n Insecure Registries:\\n  127.0.0.0/8\\n Live Restore Enabled: false\\n Product License: Community Engine\\n\\n","stderr":"[DEPRECATION NOTICE]: API is accessible on http://0.0.0.0:2375 without encryption.\\n         Access to the remote API is equivalent to root access on the host. Refer\\n         to the \'Docker daemon attack surface\' section in the documentation for\\n         more information: https://docs.docker.com/go/attack-surface/\\nIn future versions this will be a hard failure preventing the daemon from starting! Learn more at: https://docs.docker.com/go/api-security/\\n[DEPRECATION NOTICE]: API is accessible on http://0.0.0.0:2375 without encryption.\\n         Access to the remote API is equivalent to root access on the host. Refer\\n         to the \'Docker daemon attack surface\' section in the documentation for\\n         more information: https://docs.docker.com/go/attack-surface/\\nIn future versions this will be a hard failure preventing the daemon from starting! Learn more at: https://docs.docker.com/go/api-security/\\n","fail":false,"cmd":"echo \\"DOCKER_HOST=$DOCKER_HOST\\" && docker info"}',
          additional_kwargs: {},
          response_metadata: {},
        },
      };

      const result = service.transformMessageToDto(serializedMsg);

      expect(result.role).toBe('tool-shell');
      if (result.role === 'tool-shell') {
        expect(result.name).toBe('shell');
        expect(result.toolCallId).toBe('call_QrlzvPAGfR5P9k8KgEzt7zgH');
      }
      expect(result.content).toBeDefined();
      expect(result.content).toHaveProperty('exitCode', 0);
      expect(result.content).toHaveProperty('stdout');
      expect(result.content).toHaveProperty('stderr');
      expect(result.content).toHaveProperty('cmd');
      expect(result.content).toHaveProperty('fail', false);
    });
  });

  describe('transformMessagesToDto', () => {
    it('should transform multiple BaseMessages to MessageDto array', () => {
      const messages = [
        new HumanMessage('First message'),
        new AIMessage({
          content: 'Second message',
          id: 'msg-2',
        }),
      ];

      const results = service.transformMessagesToDto(messages);

      expect(results).toHaveLength(2);
      expect(results[0]?.role).toBe('human');
      expect(results[0]?.content).toBe('First message');
      expect(results[1]?.role).toBe('ai');
      expect(results[1]?.content).toBe('Second message');
    });

    it('should filter out null results', () => {
      const messages = [new HumanMessage('Valid message')];

      const results = service.transformMessagesToDto(messages);

      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('Valid message');
    });

    it('should handle empty array', () => {
      const results = service.transformMessagesToDto([]);

      expect(results).toEqual([]);
    });

    it('should handle messages with tool calls', () => {
      const messages = [
        new AIMessage({
          content: 'Using tools',
          id: 'msg-1',
          tool_calls: [
            {
              name: 'get_weather',
              args: { city: 'SF' },
              type: 'tool_call',
              id: 'call-1',
            },
          ],
        }),
      ];

      const results = service.transformMessagesToDto(messages);

      expect(results).toHaveLength(1);
      expect(results[0]?.role).toBe('ai');
      if (results[0] && 'toolCalls' in results[0] && results[0].toolCalls) {
        expect(results[0].toolCalls).toHaveLength(1);
        expect(results[0].toolCalls[0]?.name).toBe('get_weather');
      }
    });
  });
});
