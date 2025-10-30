import type { Socket } from 'socket.io-client';

import { ThreadDto } from '../../api-definitions/types.gen';
import { reqHeaders } from '../common.helper';
import { graphCleanup } from '../graphs/graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  deleteGraph,
  destroyGraph,
  executeTrigger,
  runGraph,
} from '../graphs/graphs.helper';
import {
  deleteThread,
  getThreadByExternalId,
  getThreadById,
  getThreadMessages,
  getThreads,
} from './threads.helper';

describe('Threads E2E', () => {
  // Cleanup after all tests in this describe block
  after(() => {
    graphCleanup.cleanupAllGraphs();
  });

  describe('Multi-Agent Thread Management', () => {
    it('should create one internal thread for multiple agents in the same graph execution', () => {
      let testGraphId: string;
      let threadId: string;
      let internalThreadId: string;

      // Create a graph with 2 agents connected via agent-communication-tool
      const graphData = {
        name: `Multi-Agent Thread Test ${Math.random().toString(36).slice(0, 8)}`,
        description: 'Test graph with multiple agents',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'First Agent',
                instructions:
                  'You are the first agent. When asked, use the agent-communication tool to ask the second agent a question.',
                invokeModelName: 'gpt-5-mini',
                summarizeMaxTokens: 200000,
                summarizeKeepTokens: 30000,
              },
            },
            {
              id: 'agent-2',
              template: 'simple-agent',
              config: {
                name: 'Second Agent',
                instructions:
                  'You are the second agent. Answer questions briefly.',
                invokeModelName: 'gpt-5-mini',
                summarizeMaxTokens: 200000,
                summarizeKeepTokens: 30000,
                enforceToolUsage: false,
              },
            },
            {
              id: 'comm-tool',
              template: 'agent-communication-tool',
              config: {
                description:
                  'Use this tool to communicate with the second agent for handling requests',
              },
            },
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [
            { from: 'trigger-1', to: 'agent-1' },
            { from: 'agent-1', to: 'comm-tool' },
            { from: 'comm-tool', to: 'agent-2' },
          ],
        },
      };

      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);

          // Execute trigger to start multi-agent conversation
          return executeTrigger(testGraphId, 'trigger-1', {
            messages: [
              'Ask the second agent with communication tool what 2+2 is',
            ],
            threadSubId: 'multi-agent-test',
          });
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);
          threadId = triggerResponse.body.threadId;

          // Get thread by external ID
          return getThreadByExternalId(threadId);
        })
        .then((threadResponse) => {
          expect(threadResponse.status).to.equal(200);
          expect(threadResponse.body).to.have.property('id');
          expect(threadResponse.body).to.have.property('graphId', testGraphId);
          expect(threadResponse.body).to.have.property(
            'externalThreadId',
            threadId,
          );

          internalThreadId = threadResponse.body.id;

          // Get messages for this thread
          return getThreadMessages(internalThreadId!);
        })
        .then((messagesResponse) => {
          expect(messagesResponse.status).to.equal(200);
          expect(messagesResponse.body).to.be.an('array');

          // Should have messages from both agents
          const messages = messagesResponse.body;
          const agent1Messages = messages.filter((m) => m.nodeId === 'agent-1');
          const agent2Messages = messages.filter((m) => m.nodeId === 'agent-2');

          // Both agents should have contributed messages
          expect(agent1Messages.length).to.be.greaterThan(0);
          expect(agent2Messages.length).to.be.greaterThan(0);

          // All messages should be in the same internal thread
          messages.forEach((msg) => {
            expect(msg.threadId).to.equal(internalThreadId);
          });

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should create a new internal thread for each new invocation without threadSubId', () => {
      let testGraphId: string;
      let firstThreadId: string;
      let secondThreadId: string;

      const graphData = {
        name: `New Thread Test ${Math.random().toString(36).slice(0, 8)}`,
        description: 'Test graph for new thread creation',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                instructions: 'You are a helpful test agent.',
                invokeModelName: 'gpt-5-mini',
              },
            },
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [{ from: 'trigger-1', to: 'agent-1' }],
        },
      };

      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);

          // First invocation without threadSubId
          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['First message'],
          });
        })
        .then((triggerResponse1) => {
          expect(triggerResponse1.status).to.equal(201);
          firstThreadId = triggerResponse1.body.threadId;

          // Second invocation without threadSubId
          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['Second message'],
          });
        })
        .then((triggerResponse2) => {
          expect(triggerResponse2.status).to.equal(201);
          secondThreadId = triggerResponse2.body.threadId;

          // Thread IDs should be different
          expect(firstThreadId).to.not.equal(secondThreadId);

          // Get threads for this graph
          return getThreads({ graphId: testGraphId });
        })
        .then((threadsResponse) => {
          expect(threadsResponse.status).to.equal(200);
          expect(threadsResponse.body).to.be.an('array');

          // Should have 2 internal threads
          expect(threadsResponse.body.length).to.equal(2);

          const threadIds = threadsResponse.body.map((t) => t.externalThreadId);
          expect(threadIds).to.include(firstThreadId);
          expect(threadIds).to.include(secondThreadId);

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should add messages to existing internal thread when using same threadSubId', () => {
      let testGraphId: string;
      let threadId: string;
      let internalThreadId: string;
      let initialMessageCount: number;

      const graphData = {
        name: `Existing Thread Test ${Math.random().toString(36).slice(0, 8)}`,
        description: 'Test graph for existing thread reuse',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                instructions: 'You are a helpful test agent.',
                invokeModelName: 'gpt-5-mini',
              },
            },
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [{ from: 'trigger-1', to: 'agent-1' }],
        },
      };

      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);

          // First invocation with specific threadSubId
          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['First message in thread'],
            threadSubId: 'persistent-thread',
          });
        })
        .then((triggerResponse1) => {
          expect(triggerResponse1.status).to.equal(201);
          threadId = triggerResponse1.body.threadId;

          // Get thread by external ID
          return getThreadByExternalId(threadId);
        })
        .then((threadResponse) => {
          expect(threadResponse.status).to.equal(200);
          expect(threadResponse.body).to.have.property('id');
          expect(threadResponse.body).to.have.property(
            'externalThreadId',
            threadId,
          );

          internalThreadId = threadResponse.body.id;

          // Get initial message count
          return getThreadMessages(internalThreadId!);
        })
        .then((messagesResponse1) => {
          expect(messagesResponse1.status).to.equal(200);
          initialMessageCount = messagesResponse1.body.length;
          expect(initialMessageCount).to.be.greaterThan(0);

          // Second invocation with same threadSubId
          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['Second message in same thread'],
            threadSubId: 'persistent-thread',
          });
        })
        .then((triggerResponse2) => {
          expect(triggerResponse2.status).to.equal(201);

          // Should get the same thread ID
          expect(triggerResponse2.body.threadId).to.equal(threadId);

          // Verify still only 1 internal thread
          return getThreads({ graphId: testGraphId });
        })
        .then((threadsResponse) => {
          expect(threadsResponse.status).to.equal(200);
          expect(threadsResponse.body.length).to.equal(1);

          // Get updated messages
          return getThreadMessages(internalThreadId!);
        })
        .then((messagesResponse2) => {
          expect(messagesResponse2.status).to.equal(200);

          const updatedMessageCount = messagesResponse2.body.length;

          // Should have more messages now
          expect(updatedMessageCount).to.be.greaterThan(initialMessageCount);

          // Verify both original messages are present
          const messages = messagesResponse2.body;
          const humanMessages = messages.filter(
            (m) => m.message.role === 'human',
          );

          const firstMessage = humanMessages.find(
            (m) => m.message.content === 'First message in thread',
          );
          const secondMessage = humanMessages.find(
            (m) => m.message.content === 'Second message in same thread',
          );

          expect(firstMessage).to.exist;
          expect(secondMessage).to.exist;

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should retrieve thread by ID', () => {
      let testGraphId: string;
      let internalThreadId: string;

      const graphData = {
        name: `Thread Retrieval Test ${Math.random().toString(36).slice(0, 8)}`,
        description: 'Test graph for thread retrieval',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                instructions: 'You are a helpful test agent.',
                invokeModelName: 'gpt-5-mini',
              },
            },
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [{ from: 'trigger-1', to: 'agent-1' }],
        },
      };

      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          cy.wait(2000);

          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['Test message'],
            threadSubId: 'retrieval-test',
          });
        })
        .then(() => {
          cy.wait(2000);

          return getThreads({ graphId: testGraphId });
        })
        .then((threadsResponse) => {
          expect(threadsResponse.status).to.equal(200);
          expect(threadsResponse.body.length).to.equal(1);

          internalThreadId = threadsResponse.body[0]?.id || '';

          // Retrieve thread by ID
          return getThreadById(internalThreadId);
        })
        .then((threadResponse) => {
          expect(threadResponse.status).to.equal(200);
          expect(threadResponse.body.id).to.equal(internalThreadId);
          expect(threadResponse.body.graphId).to.equal(testGraphId);
          expect(threadResponse.body).to.have.property('externalThreadId');
          expect(threadResponse.body).to.have.property('createdAt');
          expect(threadResponse.body).to.have.property('updatedAt');

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should retrieve thread by external ID', () => {
      let testGraphId: string;
      let externalThreadId: string;

      const graphData = {
        name: `External Thread Retrieval Test ${Math.random().toString(36).slice(0, 8)}`,
        description: 'Test graph for external thread retrieval',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                instructions: 'You are a helpful test agent.',
                invokeModelName: 'gpt-5-mini',
              },
            },
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [{ from: 'trigger-1', to: 'agent-1' }],
        },
      };

      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          cy.wait(2000);

          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['Test external thread retrieval'],
            threadSubId: 'external-retrieval-test',
          });
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);
          externalThreadId = triggerResponse.body.threadId;
          cy.wait(2000);

          // Test retrieving thread by external ID
          return getThreadByExternalId(externalThreadId);
        })
        .then((threadResponse) => {
          expect(threadResponse.status).to.equal(200);
          expect(threadResponse.body).to.have.property('graphId', testGraphId);
          expect(threadResponse.body).to.have.property(
            'externalThreadId',
            externalThreadId,
          );

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should filter messages by nodeId', () => {
      let testGraphId: string;
      let internalThreadId: string;

      // Create a graph with 2 agents
      const graphData = {
        name: `Filter Messages Test ${Math.random().toString(36).slice(0, 8)}`,
        description: 'Test graph for message filtering',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'First Agent',
                instructions:
                  'You are the first agent. Use the agent-communication tool to ask the second agent a simple question.',
                invokeModelName: 'gpt-5-mini',
              },
            },
            {
              id: 'agent-2',
              template: 'simple-agent',
              config: {
                name: 'Second Agent',
                instructions: 'You are the second agent. Answer briefly.',
                invokeModelName: 'gpt-5-mini',
              },
            },
            {
              id: 'comm-tool',
              template: 'agent-communication-tool',
              config: {},
            },
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [
            { from: 'trigger-1', to: 'agent-1' },
            { from: 'agent-1', to: 'comm-tool' },
            { from: 'comm-tool', to: 'agent-2' },
          ],
        },
      };

      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          cy.wait(2000);

          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['Ask agent 2 what is 1+1'],
            threadSubId: 'filter-test',
          })
            .then((triggerResponse) => {
              expect(triggerResponse.status).to.equal(201);
              const threadId = triggerResponse.body.threadId;
              cy.wait(5000);

              // Get thread by external ID
              return getThreadByExternalId(threadId);
            })
            .then((threadResponse) => {
              expect(threadResponse.status).to.equal(200);
              internalThreadId = threadResponse.body.id;

              // Get all messages
              return getThreadMessages(internalThreadId!);
            })
            .then((allMessagesResponse) => {
              expect(allMessagesResponse.status).to.equal(200);
              const allMessages = allMessagesResponse.body;

              // Get messages from agent-1 only
              return getThreadMessages(internalThreadId, {
                nodeId: 'agent-1',
              }).then((agent1Response) => {
                expect(agent1Response.status).to.equal(200);
                const agent1Messages = agent1Response.body;

                // All filtered messages should be from agent-1
                agent1Messages.forEach((msg) => {
                  expect(msg.nodeId).to.equal('agent-1');
                });

                // Should have fewer messages than total
                expect(agent1Messages.length).to.be.lessThan(
                  allMessages.length,
                );

                // Cleanup
                destroyGraph(testGraphId).then(() => {
                  deleteGraph(testGraphId);
                });
              });
            });
        });
    });

    describe('Message Deduplication', () => {
      it('should not create duplicate messages during agent execution', () => {
        let testGraphId: string;
        let internalThreadId: string;

        const graphData = createMockGraphData({
          name: `No Duplicates Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph to verify no duplicate messages',
          temporary: true,
        });

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            // Execute trigger
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['What is 2 + 2?'],
              threadSubId: 'no-duplicates-test',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);
            const threadId = triggerResponse.body.threadId;

            // Wait for execution to complete
            cy.wait(3000);

            // Get thread by external ID
            return getThreadByExternalId(threadId);
          })
          .then((threadResponse) => {
            expect(threadResponse.status).to.equal(200);
            internalThreadId = threadResponse.body.id;

            // Get all messages
            return getThreadMessages(internalThreadId!);
          })
          .then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(200);
            const messages = messagesResponse.body;

            expect(messages).to.be.an('array');
            expect(messages.length).to.be.greaterThan(0);

            // Check for duplicate messages by comparing message IDs
            const messageIds = messages.map((m) => m.id);
            const uniqueMessageIds = new Set(messageIds);
            expect(messageIds.length).to.equal(
              uniqueMessageIds.size,
              'Found duplicate message IDs - messages are being duplicated!',
            );

            // Group messages by their content and AI message ID (if present)
            const messageSignatures = messages.map((m) => {
              const msg = m.message;
              // Create a signature based on role, content, and AI message ID
              return JSON.stringify({
                role: msg.role,
                content:
                  typeof msg.content === 'string'
                    ? msg.content
                    : JSON.stringify(msg.content),
                aiMessageId: 'id' in msg ? msg.id : null,
                toolCallId: 'toolCallId' in msg ? msg.toolCallId : null,
                createdAt: m.createdAt,
              });
            });

            // Check for duplicate signatures
            const uniqueSignatures = new Set(messageSignatures);

            // Log duplicate messages if found
            if (messageSignatures.length !== uniqueSignatures.size) {
              const duplicates = messageSignatures.filter(
                (sig: string, index: unknown) =>
                  messageSignatures.indexOf(sig) !== index,
              );
              cy.log('Duplicate message signatures found:', duplicates);
            }

            expect(messageSignatures.length).to.equal(
              uniqueSignatures.size,
              'Found duplicate messages with identical content and metadata!',
            );

            // Verify each role+content combination appears only once per checkpoint
            // (messages with same role+content but different timestamps are OK for different checkpoints)
            const messagesByRoleAndContent = messages.reduce(
              (acc, m) => {
                const key = `${m.message.role}:${JSON.stringify(m.message.content)}:${'id' in m.message ? m.message.id || '' : ''}`;
                if (!acc[key]) {
                  acc[key] = [];
                }
                acc[key].push(m);
                return acc;
              },
              {} as Record<string, typeof messages>,
            );

            // Check each group for exact duplicates (same timestamp)
            Object.entries(messagesByRoleAndContent).forEach(([key, msgs]) => {
              if (msgs.length > 1) {
                const timestamps = msgs.map((m) => m.createdAt);
                const uniqueTimestamps = new Set(timestamps);

                if (timestamps.length !== uniqueTimestamps.size) {
                  cy.log(
                    `Found ${msgs.length} identical messages with key: ${key}`,
                  );
                  cy.log('Messages:', msgs);
                }

                expect(
                  timestamps.length,
                  `Found ${msgs.length} messages with identical content and timestamps for key: ${key}`,
                ).to.equal(uniqueTimestamps.size);
              }
            });

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should not create duplicate messages with shell tool execution', () => {
        let testGraphId: string;
        let internalThreadId: string;

        const graphData = {
          name: `Shell Tool No Duplicates ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test shell tool for duplicate messages',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Shell Test Agent',
                  instructions:
                    'You are a shell command executor. Use the shell tool when asked.',
                  invokeModelName: 'gpt-5-mini',
                },
              },
              {
                id: 'shell-tool-1',
                template: 'shell-tool',
                config: {},
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'shell-tool-1' },
            ],
          },
        };

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            // Execute trigger with shell command
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Use the shell tool to execute: echo "test"'],
              threadSubId: 'shell-no-duplicates-test',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);
            const threadId = triggerResponse.body.threadId;

            // Wait for execution to complete
            cy.wait(5000);

            // Get thread by external ID
            return getThreadByExternalId(threadId);
          })
          .then((threadResponse) => {
            expect(threadResponse.status).to.equal(200);
            internalThreadId = threadResponse.body.id;

            // Get all messages
            return getThreadMessages(internalThreadId!);
          })
          .then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(200);
            const messages = messagesResponse.body;

            expect(messages).to.be.an('array');
            expect(messages.length).to.be.greaterThan(0);

            cy.log(`Total messages: ${messages.length}`);

            // Check for duplicate message IDs
            const messageIds = messages.map((m) => m.id);
            const uniqueMessageIds = new Set(messageIds);
            expect(messageIds.length).to.equal(
              uniqueMessageIds.size,
              'Found duplicate message IDs!',
            );

            // Group by AI message ID and check for duplicates
            const aiMessages = messages.filter((m) => m.message.role === 'ai');
            const aiMessageIds = aiMessages
              .map((m) => ('id' in m.message ? m.message.id : undefined))
              .filter(Boolean);

            // Check that each AI message ID appears only once
            const aiMessageIdCounts = aiMessageIds.reduce(
              (acc, id) => {
                if (id) {
                  acc[id] = (acc[id] || 0) + 1;
                }
                return acc;
              },
              {} as Record<string, number>,
            );

            Object.entries(aiMessageIdCounts).forEach(([id, count]) => {
              expect(
                count,
                `AI message with id ${id} appears ${count} times`,
              ).to.equal(1);
            });

            // Check tool messages are not duplicated
            const toolMessages = messages.filter(
              (m) =>
                m.message.role === 'tool-shell' || m.message.role === 'tool',
            );

            const toolMessagesByCallId = toolMessages.reduce(
              (acc, m) => {
                const callId =
                  'toolCallId' in m.message ? m.message.toolCallId : undefined;
                if (callId) {
                  if (!acc[callId]) {
                    acc[callId] = [];
                  }
                  acc[callId].push(m);
                }
                return acc;
              },
              {} as Record<string, typeof messages>,
            );

            Object.entries(toolMessagesByCallId).forEach(([callId, msgs]) => {
              expect(
                msgs.length,
                `Tool message with toolCallId ${callId} appears ${msgs.length} times`,
              ).to.equal(1);
            });

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });
    });

    describe('Message Retrieval and Thread Management', () => {
      it('should retrieve messages for a thread after execution', () => {
        const testMessage = 'Hello, test agent!';
        let testGraphId: string;

        // Create and run a test graph
        const graphData = createMockGraphData();
        createGraph(graphData)
          .then((response) => {
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            // Wait for graph to fully initialize
            cy.wait(2000);

            // Execute a trigger to create some messages
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: [testMessage],
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);
            expect(triggerResponse.body).to.have.property('threadId');
            expect(triggerResponse.body).to.have.property('checkpointNs');

            // Get messages using thread API
            return getThreads({ graphId: testGraphId }).then((threadsRes) => {
              const internalThreadId = threadsRes.body[0]?.id;
              return getThreadMessages(internalThreadId!);
            });
          })
          .then((response) => {
            expect(response.status).to.equal(200);
            expect(response.body).to.be.an('array');
            expect(response.body.length).to.be.greaterThan(0);

            // Verify our sent message is included
            const humanMessage = response.body
              .map((m) => m.message)
              .find((msg) => msg.role === 'human');
            expect(humanMessage).to.exist;
            expect(humanMessage?.content).to.include(testMessage);

            // Verify message structure
            const firstMessage = response.body[0]?.message;
            expect(firstMessage).to.have.property('role');
            expect(firstMessage).to.have.property('content');

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should limit messages when limit parameter is provided', () => {
        let testGraphId: string;

        // Create and run a test graph
        const graphData = createMockGraphData();
        createGraph(graphData)
          .then((response) => {
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            // Wait for graph to fully initialize
            cy.wait(2000);

            // Execute to create messages with custom threadId
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Test message with multiple interactions'],
              threadSubId: 'limit-test-thread',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);

            // Get messages with limit
            return getThreads({ graphId: testGraphId }).then((threadsRes) => {
              const internalThreadId = threadsRes.body[0]?.id;
              return getThreadMessages(internalThreadId!, { limit: 2 });
            });
          })
          .then((response) => {
            expect(response.status).to.equal(200);
            expect(response.body).to.be.an('array');
            expect(response.body.length).to.be.at.most(2);

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should include human and AI messages', () => {
        const testQuestion = 'What is 2+2?';
        let testGraphId: string;

        // Create and run a test graph
        const graphData = createMockGraphData();
        createGraph(graphData)
          .then((response) => {
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            // Wait for graph to fully initialize
            cy.wait(2000);

            return executeTrigger(testGraphId, 'trigger-1', {
              messages: [testQuestion],
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);

            return getThreads({ graphId: testGraphId }).then((threadsRes) => {
              const internalThreadId = threadsRes.body[0]?.id;
              return getThreadMessages(internalThreadId!);
            });
          })
          .then((response) => {
            expect(response.status).to.equal(200);
            const messages = response.body.map((m) => m.message);

            // Should have at least a human message and an AI response
            expect(messages).to.be.an('array');
            expect(messages.length).to.be.greaterThan(1);

            // Find and verify our sent message is included
            const humanMessage = messages.find((msg) => msg.role === 'human');
            expect(humanMessage).to.exist;
            expect(humanMessage?.content).to.equal(testQuestion);

            // Find AI message (response should be present)
            const aiMessage = messages.find((msg) => msg.role === 'ai');
            expect(aiMessage).to.exist;
            expect(aiMessage?.content).to.be.a('string');

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should execute trigger with async=true and return immediately', () => {
        const graphData = {
          name: `Async Trigger Test ${Date.now()}`,
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Async Agent',
                  instructions: 'You are a helpful test agent.',
                  invokeModelName: 'gpt-5-mini',
                },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [{ from: 'trigger-1', to: 'agent-1' }],
          },
        } as const;

        let testGraphId = '';

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);

            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Say hello and then finish.'],
              async: true,
            });
          })
          .then((execResponse) => {
            expect(execResponse.status).to.equal(201);
            expect(execResponse.body).to.have.property('threadId');
            const threadId = execResponse.body.threadId as string;
            expect(execResponse.body).to.have.property('checkpointNs');

            cy.wait(3000);

            return getThreadByExternalId(threadId);
          })
          .then((threadRes) => {
            expect(threadRes.status).to.equal(200);
            const internalThreadId = threadRes.body.id;
            return getThreadMessages(internalThreadId);
          })
          .then((messagesRes) => {
            expect(messagesRes.status).to.equal(200);
            expect(messagesRes.body.length).to.be.greaterThan(0);

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should persist messages across graph restarts', () => {
        const testMessage = 'Message before restart';
        let testGraphId: string;
        let initialMessageCount: number;

        // Create and run a test graph
        const graphData = createMockGraphData();
        createGraph(graphData)
          .then((response) => {
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            // Wait for graph to fully initialize
            cy.wait(2000);

            // Execute a trigger with custom threadId
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: [testMessage],
              threadSubId: 'persist-test',
            });
          })
          .then((response) => {
            expect(response.status).to.equal(201);

            // Get the threadId from first execution
            return getThreads({ graphId: testGraphId }).then((threadsRes) => {
              const internalThreadId = threadsRes.body[0]?.id;
              return getThreadMessages(internalThreadId!);
            });
          })
          .then((firstResponse) => {
            expect(firstResponse.status).to.equal(200);
            expect(firstResponse.body.length).to.be.greaterThan(0);

            initialMessageCount = firstResponse.body.length;
            expect(initialMessageCount).to.be.greaterThan(0);

            // Verify our sent message is in the first response
            const firstHumanMessage = firstResponse.body
              .map((m) => m.message)
              .find((msg) => msg.role === 'human');
            expect(firstHumanMessage).to.exist;
            expect(firstHumanMessage?.content).to.equal(testMessage);

            // Stop and restart the graph
            return destroyGraph(testGraphId);
          })
          .then(() => {
            return runGraph(testGraphId);
          })
          .then(() => {
            // Get messages again with the same threadId component
            return getThreads({ graphId: testGraphId }).then((threadsRes) => {
              const internalThreadId = threadsRes.body[0]?.id;
              return getThreadMessages(internalThreadId!);
            });
          })
          .then((secondResponse) => {
            expect(secondResponse.status).to.equal(200);
            expect(secondResponse.body.length).to.equal(initialMessageCount);

            // Verify our sent message is still preserved after restart
            const humanMessage = secondResponse.body
              .map((m) => m.message)
              .find((msg) => msg.role === 'human');
            expect(humanMessage).to.exist;
            expect(humanMessage?.content).to.equal(testMessage);

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should isolate messages between different threads', () => {
        const thread1Message = 'Message for thread 1';
        const thread2Message = 'Message for thread 2';
        let testGraphId: string;

        // Create and run a test graph
        const graphData = createMockGraphData();
        createGraph(graphData)
          .then((response) => {
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            // Wait for graph to fully initialize
            cy.wait(2000);

            // Execute trigger for thread 1
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: [thread1Message],
              threadSubId: 'thread-1',
            });
          })
          .then((response1) => {
            expect(response1.status).to.equal(201);
            const thread1Component = response1.body.threadId.split(':')[1];

            // Execute trigger for thread 2
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: [thread2Message],
              threadSubId: 'thread-2',
            }).then((response2) => {
              expect(response2.status).to.equal(201);
              const thread2Component = response2.body.threadId.split(':')[1];

              // Get messages for thread 1
              return getThreads({ graphId: testGraphId })
                .then((threadsRes) => {
                  const thread1InternalId = threadsRes.body.find(
                    (t) =>
                      t.externalThreadId ===
                      `${testGraphId}:${thread1Component}`,
                  )?.id;
                  return getThreadMessages(thread1InternalId!);
                })
                .then((messagesResponse1) => {
                  expect(messagesResponse1.status).to.equal(200);
                  expect(messagesResponse1.body.length).to.be.greaterThan(0);

                  const thread1Messages = messagesResponse1.body.map(
                    (m) => m.message,
                  );
                  const thread1HumanMsg = thread1Messages.find(
                    (msg) => msg.role === 'human',
                  );
                  expect(thread1HumanMsg).to.exist;
                  expect(thread1HumanMsg?.content).to.equal(thread1Message);

                  // Verify thread 2 message is NOT in thread 1
                  const thread2MessageInThread1 = thread1Messages.find(
                    (msg) => msg.content === thread2Message,
                  );
                  expect(thread2MessageInThread1).to.not.exist;

                  // Get messages for thread 2
                  return getThreads({ graphId: testGraphId }).then(
                    (threadsRes) => {
                      const thread2InternalId = threadsRes.body.find(
                        (t) =>
                          t.externalThreadId ===
                          `${testGraphId}:${thread2Component}`,
                      )?.id;
                      return getThreadMessages(thread2InternalId!);
                    },
                  );
                })
                .then((messagesResponse2) => {
                  expect(messagesResponse2.status).to.equal(200);
                  expect(messagesResponse2.body.length).to.be.greaterThan(0);

                  const thread2Messages = messagesResponse2.body.map(
                    (m) => m.message,
                  );
                  const thread2HumanMsg = thread2Messages.find(
                    (msg) => msg.role === 'human',
                  );
                  expect(thread2HumanMsg).to.exist;
                  expect(thread2HumanMsg?.content).to.equal(thread2Message);

                  // Verify thread 1 message is NOT in thread 2
                  const thread1MessageInThread2 = thread2Messages.find(
                    (msg) => msg.content === thread1Message,
                  );
                  expect(thread1MessageInThread2).to.not.exist;

                  // Cleanup
                  destroyGraph(testGraphId).then(() => {
                    deleteGraph(testGraphId);
                  });
                });
            });
          });
      });

      it('should isolate messages between different threadSubIds with aggressive summarization', () => {
        const thread1Message = 'Hello from thread 1 - what is 2+2?';
        const thread2Message = 'Hello from thread 2 - what is 3+3?';
        let testGraphId: string;

        // Create a graph with aggressive summarization settings
        const graphData = {
          name: `Test Graph with Aggressive Summarization ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph with aggressive summarization settings',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Test Agent with Aggressive Summarization',
                  instructions:
                    'You are a helpful test agent. Please provide detailed responses to test summarization behavior.',
                  invokeModelName: 'gpt-5-mini',
                  summarizeMaxTokens: 100, // Very low max tokens to force summarization
                  summarizeKeepTokens: 50, // Very low keep tokens
                },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [
              {
                from: 'trigger-1',
                to: 'agent-1',
              },
            ],
          },
        };

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;

            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);

            // Execute trigger for thread 1
            executeTrigger(testGraphId, 'trigger-1', {
              messages: [thread1Message],
              threadSubId: 'isolation-thread-1',
            }).then((response1) => {
              expect(response1.status).to.equal(201);
              expect(response1.body).to.have.property('threadId');
              const thread1Id = response1.body.threadId;

              // Execute trigger for thread 2
              executeTrigger(testGraphId, 'trigger-1', {
                messages: [thread2Message],
                threadSubId: 'isolation-thread-2',
              }).then((response2) => {
                expect(response2.status).to.equal(201);
                expect(response2.body).to.have.property('threadId');
                const thread2Id = response2.body.threadId;

                // Verify thread IDs are different
                expect(thread1Id).to.not.equal(thread2Id);

                // Get messages for thread 1
                getThreads({ graphId: testGraphId })
                  .then((threadsRes) => {
                    const thread1InternalId = threadsRes.body.find(
                      (t) => t.externalThreadId === thread1Id,
                    )?.id;
                    return getThreadMessages(thread1InternalId!);
                  })
                  .then((messagesResponse1) => {
                    expect(messagesResponse1.status).to.equal(200);
                    expect(messagesResponse1.body).to.be.an('array');
                    expect(messagesResponse1.body.length).to.be.greaterThan(0);

                    const thread1Messages = messagesResponse1.body.map(
                      (m) => m.message,
                    );

                    // Find the human message in thread 1
                    const humanMessage1 = thread1Messages.find(
                      (msg) => msg.role === 'human',
                    );
                    expect(humanMessage1).to.exist;
                    expect(humanMessage1?.content).to.equal(thread1Message);

                    // Get messages for thread 2
                    getThreads({ graphId: testGraphId })
                      .then((threadsRes) => {
                        const thread2InternalId = threadsRes.body.find(
                          (t) => t.externalThreadId === thread2Id,
                        )?.id;
                        return getThreadMessages(thread2InternalId!);
                      })
                      .then((messagesResponse2) => {
                        expect(messagesResponse2.status).to.equal(200);
                        expect(messagesResponse2.body).to.be.an('array');
                        expect(messagesResponse2.body.length).to.be.greaterThan(
                          0,
                        );

                        const thread2Messages = messagesResponse2.body.map(
                          (m) => m.message,
                        );

                        // Find the human message in thread 2
                        const humanMessage2 = thread2Messages.find(
                          (msg) => msg.role === 'human',
                        );
                        expect(humanMessage2).to.exist;
                        expect(humanMessage2?.content).to.equal(thread2Message);

                        // Verify messages are isolated - thread 1 should not contain thread 2's message
                        const thread1ContainsThread2Message =
                          thread1Messages.some(
                            (msg) => msg.content === thread2Message,
                          );
                        expect(thread1ContainsThread2Message).to.be.false;

                        // Verify messages are isolated - thread 2 should not contain thread 1's message
                        const thread2ContainsThread1Message =
                          thread2Messages.some(
                            (msg) => msg.content === thread1Message,
                          );
                        expect(thread2ContainsThread1Message).to.be.false;

                        // Clean up the test graph
                        destroyGraph(testGraphId).then(() => {
                          deleteGraph(testGraphId);
                        });
                      });
                  });
              });
            });
          });
      });

      it('should preserve full message history with conservative summarization', () => {
        const testMessage = 'What is the capital of France?';
        const followUpMessage = 'And what is the capital of Germany?';
        let testGraphId: string;

        // Create a graph with conservative summarization settings
        const graphData = {
          name: `Test Graph with Conservative Summarization ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph with conservative summarization settings',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Test Agent with Conservative Summarization',
                  instructions:
                    'You are a helpful test agent. Please provide detailed responses to test summarization behavior.',
                  invokeModelName: 'gpt-5-mini',
                  summarizeMaxTokens: 8000, // High max tokens to avoid summarization
                  summarizeKeepTokens: 2000, // High keep tokens
                },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [
              {
                from: 'trigger-1',
                to: 'agent-1',
              },
            ],
          },
        };

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;

            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);

            // Execute first trigger
            executeTrigger(testGraphId, 'trigger-1', {
              messages: [testMessage],
              threadSubId: 'history-test-thread',
            }).then((response1) => {
              expect(response1.status).to.equal(201);
              const threadId = response1.body.threadId;

              // Wait a bit for processing
              cy.wait(2000);

              // Get messages after first execution
              getThreads({ graphId: testGraphId })
                .then((threadsRes) => {
                  const internalThreadId = threadsRes.body.find(
                    (t) => t.externalThreadId === threadId,
                  )?.id;
                  return getThreadMessages(internalThreadId!);
                })
                .then((messagesResponse1) => {
                  expect(messagesResponse1.status).to.equal(200);
                  const messages1 = messagesResponse1.body.map(
                    (m) => m.message,
                  );

                  // Verify we have the original human message
                  const humanMessage = messages1.find(
                    (msg) => msg.role === 'human',
                  );
                  expect(humanMessage).to.exist;
                  expect(humanMessage?.content).to.equal(testMessage);

                  // Execute second trigger with same threadSubId (should continue conversation)
                  executeTrigger(testGraphId, 'trigger-1', {
                    messages: [followUpMessage],
                    threadSubId: 'history-test-thread',
                  }).then((response2) => {
                    expect(response2.status).to.equal(201);
                    // Should get the same thread ID since we used the same threadSubId
                    expect(response2.body.threadId).to.equal(threadId);

                    // Wait a bit for processing
                    cy.wait(2000);

                    // Get messages after second execution
                    getThreads({ graphId: testGraphId })
                      .then((threadsRes) => {
                        const internalThreadId = threadsRes.body.find(
                          (t) => t.externalThreadId === threadId,
                        )?.id;
                        return getThreadMessages(internalThreadId!);
                      })
                      .then((messagesResponse2) => {
                        expect(messagesResponse2.status).to.equal(200);
                        const messages2 = messagesResponse2.body.map(
                          (m) => m.message,
                        );

                        // Verify we still have the original human message
                        const originalHumanMessage = messages2.find(
                          (msg) =>
                            msg.role === 'human' && msg.content === testMessage,
                        );
                        expect(originalHumanMessage).to.exist;

                        // Verify we have the follow-up human message
                        const followUpHumanMessage = messages2.find(
                          (msg) =>
                            msg.role === 'human' &&
                            msg.content === followUpMessage,
                        );
                        expect(followUpHumanMessage).to.exist;

                        // Verify we have more messages than before (conversation continued)
                        expect(messages2.length).to.be.greaterThan(
                          messages1.length,
                        );

                        // Verify message order - original should come before follow-up
                        const originalIndex = messages2.findIndex(
                          (msg) => msg.content === testMessage,
                        );
                        const followUpIndex = messages2.findIndex(
                          (msg) => msg.content === followUpMessage,
                        );
                        expect(originalIndex).to.be.lessThan(followUpIndex);

                        // Clean up the test graph
                        destroyGraph(testGraphId).then(() => {
                          deleteGraph(testGraphId);
                        });
                      });
                  });
                });
            });
          });
      });
    });

    describe('Thread Deletion', () => {
      it('should delete a thread and its messages', () => {
        let testGraphId: string;
        let internalThreadId: string;

        const graphData = {
          name: `Delete Thread Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph for thread deletion',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Test Agent',
                  instructions: 'You are a helpful test agent.',
                  invokeModelName: 'gpt-5-mini',
                },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [{ from: 'trigger-1', to: 'agent-1' }],
          },
        };

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Test message for deletion'],
              threadSubId: 'delete-test',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);

            // Get thread by external ID
            return getThreadByExternalId(triggerResponse.body.threadId);
          })
          .then((threadResponse) => {
            expect(threadResponse.status).to.equal(200);
            internalThreadId = threadResponse.body.id;

            // Verify thread exists and has messages
            return getThreadMessages(internalThreadId);
          })
          .then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(200);
            expect(messagesResponse.body.length).to.be.greaterThan(0);

            // Delete the thread
            return deleteThread(internalThreadId);
          })
          .then((deleteResponse) => {
            expect(deleteResponse.status).to.equal(200);

            // Verify thread is deleted - should return 404
            return getThreadById(internalThreadId);
          })
          .then((getResponse) => {
            expect(getResponse.status).to.equal(404);

            // Verify messages are also deleted
            return getThreadMessages(internalThreadId);
          })
          .then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(404);

            // Verify thread is not in the threads list
            return getThreads({ graphId: testGraphId });
          })
          .then((threadsResponse) => {
            expect(threadsResponse.status).to.equal(200);
            expect(threadsResponse.body.length).to.equal(0);

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should return 404 when trying to delete non-existent thread', () => {
        const nonExistentThreadId = 'non-existent-thread-id';

        deleteThread(nonExistentThreadId).then((response) => {
          expect(response.status).to.equal(404);
        });
      });

      it('should not allow deleting thread from different user', () => {
        let testGraphId: string;
        let internalThreadId: string;

        const graphData = {
          name: `Cross User Delete Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph for cross-user deletion',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Test Agent',
                  instructions: 'You are a helpful test agent.',
                  invokeModelName: 'gpt-5-mini',
                },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [{ from: 'trigger-1', to: 'agent-1' }],
          },
        };

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Test message'],
              threadSubId: 'cross-user-test',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);

            return getThreadByExternalId(triggerResponse.body.threadId);
          })
          .then((threadResponse) => {
            expect(threadResponse.status).to.equal(200);
            internalThreadId = threadResponse.body.id;

            // Try to delete with different user headers (simulating different user)
            const differentUserHeaders = {
              ...reqHeaders,
              authorization: 'Bearer different-user-token',
            };

            return deleteThread(internalThreadId, differentUserHeaders);
          })
          .then((deleteResponse) => {
            // Should return 404 because thread doesn't belong to this user
            expect(deleteResponse.status).to.equal(404);

            // Verify thread still exists for original user
            return getThreadById(internalThreadId);
          })
          .then((getResponse) => {
            expect(getResponse.status).to.equal(200);
            expect(getResponse.body.id).to.equal(internalThreadId);

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should delete thread and all its messages in multi-agent scenario', () => {
        let testGraphId: string;
        let internalThreadId: string;

        const graphData = {
          name: `Multi-Agent Delete Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph for multi-agent thread deletion',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'First Agent',
                  instructions:
                    'You are the first agent. Use the agent-communication tool to ask the second agent a question.',
                  invokeModelName: 'gpt-5-mini',
                },
              },
              {
                id: 'agent-2',
                template: 'simple-agent',
                config: {
                  name: 'Second Agent',
                  instructions: 'You are the second agent. Answer briefly.',
                  invokeModelName: 'gpt-5-mini',
                },
              },
              {
                id: 'comm-tool',
                template: 'agent-communication-tool',
                config: {},
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'comm-tool' },
              { from: 'comm-tool', to: 'agent-2' },
            ],
          },
        };

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Ask agent 2 what is 2+2'],
              threadSubId: 'multi-agent-delete-test',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);

            return getThreadByExternalId(triggerResponse.body.threadId);
          })
          .then((threadResponse) => {
            expect(threadResponse.status).to.equal(200);
            internalThreadId = threadResponse.body.id;

            // Get messages from both agents
            return getThreadMessages(internalThreadId);
          })
          .then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(200);
            const messages = messagesResponse.body;

            // Should have messages from both agents
            const agent1Messages = messages.filter(
              (m) => m.nodeId === 'agent-1',
            );
            const agent2Messages = messages.filter(
              (m) => m.nodeId === 'agent-2',
            );

            expect(agent1Messages.length).to.be.greaterThan(0);
            expect(agent2Messages.length).to.be.greaterThan(0);

            // Delete the thread
            return deleteThread(internalThreadId);
          })
          .then((deleteResponse) => {
            expect(deleteResponse.status).to.equal(200);

            // Verify thread is deleted
            return getThreadById(internalThreadId);
          })
          .then((getResponse) => {
            expect(getResponse.status).to.equal(404);

            // Verify all messages are deleted
            return getThreadMessages(internalThreadId);
          })
          .then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(404);

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });
    });

    describe('Thread Name Generation', () => {
      it('should automatically generate and set thread name on first execution', () => {
        let testGraphId: string;
        let internalThreadId: string;

        const graphData = {
          name: `Thread Name Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph for thread name generation',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Test Agent',
                  instructions: 'You are a helpful test agent.',
                  invokeModelName: 'gpt-5-mini',
                  summarizeMaxTokens: 200000,
                  summarizeKeepTokens: 30000,
                },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [{ from: 'trigger-1', to: 'agent-1' }],
          },
        };

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            // Execute trigger with a descriptive message that should generate a title
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['What is the weather like today in San Francisco?'],
              threadSubId: 'thread-name-test',
            });
          })
          .then(() => {
            // Wait for title generation to complete
            cy.wait(5000);

            return getThreads({ graphId: testGraphId });
          })
          .then((threadsResponse) => {
            expect(threadsResponse.status).to.equal(200);
            expect(threadsResponse.body.length).to.equal(1);

            internalThreadId = threadsResponse.body[0]?.id || '';

            // Retrieve thread and verify it has a name
            return getThreadById(internalThreadId);
          })
          .then((threadResponse) => {
            expect(threadResponse.status).to.equal(200);
            expect(threadResponse.body.id).to.equal(internalThreadId);

            // Verify thread has a name set
            const threadWithName = threadResponse.body as ThreadDto & {
              name?: string | null;
            };
            expect(threadWithName).to.have.property('name');
            expect(threadWithName.name).to.be.a('string');
            expect(threadWithName.name).to.not.be.empty;
            // Name should be related to the user's question about weather
            if (threadWithName.name) {
              expect(threadWithName.name.length).to.be.lte(100);
            }

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should not update thread name if it already exists', () => {
        let testGraphId: string;
        let internalThreadId: string;
        let originalName: string;

        const graphData = {
          name: `Thread Name Update Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph for thread name persistence',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Test Agent',
                  instructions: 'You are a helpful test agent.',
                  invokeModelName: 'gpt-5-mini',
                  summarizeMaxTokens: 200000,
                  summarizeKeepTokens: 30000,
                },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [{ from: 'trigger-1', to: 'agent-1' }],
          },
        };

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            // First execution - should generate a name
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['First message about weather'],
              threadSubId: 'thread-name-persistence-test',
            });
          })
          .then(() => {
            cy.wait(5000);

            return getThreads({ graphId: testGraphId });
          })
          .then((threadsResponse) => {
            expect(threadsResponse.status).to.equal(200);
            internalThreadId = threadsResponse.body[0]?.id || '';

            return getThreadById(internalThreadId);
          })
          .then((threadResponse) => {
            const threadWithName = threadResponse.body as ThreadDto & {
              name?: string | null;
            };
            expect(threadWithName).to.have.property('name');
            originalName = threadWithName.name || '';

            // Second execution with different message
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Second message about different topic'],
              threadSubId: 'thread-name-persistence-test',
            });
          })
          .then(() => {
            cy.wait(5000);

            // Verify the name hasn't changed
            return getThreadById(internalThreadId);
          })
          .then((threadResponse) => {
            const threadWithName = threadResponse.body as ThreadDto & {
              name?: string | null;
            };
            expect(threadWithName).to.have.property('name');
            expect(threadWithName.name).to.equal(originalName);

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should receive socket notifications for thread state updates', () => {
        let testGraphId: string;
        let socket: Socket | undefined;

        const graphData = {
          name: `Socket Notification Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph for socket notifications',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Test Agent',
                  instructions: 'You are a helpful test agent.',
                  invokeModelName: 'gpt-5-mini',
                  summarizeMaxTokens: 200000,
                  summarizeKeepTokens: 30000,
                },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [{ from: 'trigger-1', to: 'agent-1' }],
          },
        };

        // Connect to socket
        cy.window().then((win) => {
          const io = (win as { io?: (...args: unknown[]) => Socket }).io;
          if (io) {
            socket = io('http://localhost:3000', {
              auth: {
                token: 'dev-token',
                'x-dev-jwt-sub': 'test-user',
              },
            });

            // Listen for agent state update events
            const stateUpdateEvents: Record<string, unknown>[] = [];
            socket.on('agent.state.update', (data: Record<string, unknown>) => {
              stateUpdateEvents.push(data);
            });

            // Store events for later verification
            (
              win as unknown as { stateUpdateEvents?: unknown[] }
            ).stateUpdateEvents = stateUpdateEvents;
          }
        });

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            // Subscribe to graph updates
            if (socket) {
              socket.emit('subscribe_graph', { graphId: testGraphId });
            }

            // Execute trigger
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Test message for socket notifications'],
              threadSubId: 'socket-test-thread',
            });
          })
          .then(() => {
            // Wait for processing and notifications
            cy.wait(10000);

            return getThreads({ graphId: testGraphId });
          })
          .then((threadsResponse) => {
            expect(threadsResponse.status).to.equal(200);

            // Check if we received socket notifications
            cy.window().then((win) => {
              const stateUpdateEvents =
                (win as unknown as { stateUpdateEvents?: unknown[] })
                  .stateUpdateEvents || [];

              // We should have received at least one agent state update
              expect(stateUpdateEvents.length).to.be.greaterThan(0);

              // Find the notification with generatedTitle
              const titleUpdateEvent = (
                stateUpdateEvents as {
                  data?: { generatedTitle?: string };
                  type?: string;
                  graphId?: string;
                }[]
              ).find((event) => event.data && event.data.generatedTitle);

              expect(titleUpdateEvent).to.exist;
              // TypeScript narrowing for runtime assertion above
              const nonNullEvent = titleUpdateEvent!;
              expect(nonNullEvent.type).to.equal('agent.state.update');
              expect(nonNullEvent.graphId).to.equal(testGraphId);
              expect(nonNullEvent.data!.generatedTitle).to.be.a('string');
              expect(nonNullEvent.data!.generatedTitle).to.not.be.empty;
            });

            // Cleanup
            if (socket) {
              socket.disconnect();
            }
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });
    });
  });
});
