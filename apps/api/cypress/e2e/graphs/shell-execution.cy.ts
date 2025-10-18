import { graphCleanup } from './graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  deleteGraph,
  destroyGraph,
  executeTrigger,
  getNodeMessages,
  runGraph,
} from './graphs.helper';

describe('Shell Execution E2E', () => {
  let shellGraphId: string;

  // Cleanup after all tests in this describe block
  after(() => {
    graphCleanup.cleanupAllGraphs();
  });

  describe('Execute Shell Commands via Graph Runtime', () => {
    it('should create a graph with docker runtime and shell tool', () => {
      const graphData = createMockGraphDataWithShellTool({
        env: {
          FOO: 'bar',
        },
      });

      createGraph(graphData).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('id');
        expect(response.body).to.have.property('status', 'created');
        shellGraphId = response.body.id;
      });
    });

    it('should run the graph with shell tool', () => {
      runGraph(shellGraphId).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('status', 'running');
      });
    });

    it('should execute a simple shell command (echo)', () => {
      const testCommand = 'Execute the command: echo "Hello from Cypress test"';
      const triggerData = {
        messages: [testCommand],
      };

      executeTrigger(shellGraphId, 'trigger-1', triggerData).then(
        (response) => {
          expect(response.status).to.equal(201);
          expect(response.body).to.have.property('threadId');
          expect(response.body).to.have.property('checkpointNs');

          // Verify messages were created
          getNodeMessages(shellGraphId, 'agent-1', {
            threadId: response.body.threadId,
          }).then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(200);
            expect(messagesResponse.body.threads).to.be.an('array');
            expect(messagesResponse.body.threads.length).to.be.greaterThan(0);

            const thread = messagesResponse.body.threads[0];
            const messages = thread.messages;
            expect(messages.length).to.be.greaterThan(0);

            // Verify our sent command is included
            const humanMessage = messages.find((msg) => msg.role === 'human');
            expect(humanMessage).to.exist;
            expect(humanMessage.content).to.equal(testCommand);

            // Find the shell tool message
            const shellMessage = messages.find(
              (msg) => msg.role === 'tool-shell' && msg['name'] === 'shell',
            );
            expect(shellMessage).to.exist;
            expect(shellMessage).to.have.property('name', 'shell');
            expect(shellMessage).to.have.property('toolCallId');

            // Verify shell message content structure (ShellToolResultDto)
            const shellContent = shellMessage.content;
            expect(shellContent).to.be.an('object');
            expect(shellContent)
              .to.have.property('exitCode')
              .that.is.a('number');
            expect(shellContent).to.have.property('stdout').that.is.a('string');
            expect(shellContent).to.have.property('stderr').that.is.a('string');
            expect(shellContent).to.have.property('cmd').that.is.a('string');

            // Verify the shell command output
            expect(shellContent).to.have.property('exitCode', 0);
            expect(String(shellContent['stdout']).toLowerCase()).to.satisfy(
              (content: string) =>
                content.includes('hello') || content.includes('cypress'),
              'Shell output should contain the echo result',
            );
          });
        },
      );
    });

    it('should execute a shell command with environment variables', () => {
      const triggerData = {
        messages: [
          'Execute the shell command to print environment variable: echo $FOO',
        ],
        threadSubId: 'env-test',
      };

      executeTrigger(shellGraphId, 'trigger-1', triggerData).then(
        (response) => {
          expect(response.status).to.equal(201);
          expect(response.body).to.have.property('threadId');
          expect(response.body).to.have.property('checkpointNs');

          // Verify messages were created
          getNodeMessages(shellGraphId, 'agent-1', {
            threadId: response.body.threadId,
          }).then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(200);
            expect(messagesResponse.body.threads).to.be.an('array');
            expect(messagesResponse.body.threads.length).to.be.greaterThan(0);

            const thread = messagesResponse.body.threads[0];
            const messages = thread.messages;
            expect(messages.length).to.be.greaterThan(0);

            expect(
              messages.find(
                (msg) =>
                  msg.content === triggerData.messages[0] &&
                  msg.role === 'human',
              ),
            ).to.not.be.undefined;

            // Find shell tool messages
            const shellMessages = messages.filter(
              (msg) => msg.role === 'tool-shell' && msg['name'] === 'shell',
            );
            expect(shellMessages.length).to.greaterThan(0);

            // Verify shell messages have proper structure
            shellMessages.forEach((msg) => {
              expect(msg['name']).to.equal('shell');
              expect(msg.content).to.be.an('object');
              expect(msg.content).to.have.property('exitCode');
              expect(msg.content).to.have.property('stdout');
              expect(msg.content).to.have.property('stderr');
              expect(msg.content).to.have.property('cmd');
            });

            // Verify the shell execution output contains FOO=bar
            const envVarShellMessage = shellMessages.find((msg) => {
              const content = msg.content as any;
              return (
                content.stdout?.includes('bar') &&
                (content.cmd?.includes('$FOO') || content.cmd?.includes('echo'))
              );
            });
            expect(envVarShellMessage).to.exist;
            expect((envVarShellMessage.content as any).exitCode).to.equal(0);
          });
        },
      );
    });

    it('should destroy the running graph', () => {
      destroyGraph(shellGraphId).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('status', 'stopped');
      });
    });

    it('should delete the graph', () => {
      deleteGraph(shellGraphId).then((response) => {
        expect(response.status).to.equal(200);
      });
    });
  });

  describe('Shell Command Execution with Different Runtime Configurations', () => {
    let customRuntimeGraphId: string;

    it('should create graph with custom Docker image (alpine)', () => {
      const graphData = createMockGraphDataWithShellTool({
        dockerImage: 'alpine:latest',
        workdir: '/tmp',
      });

      createGraph(graphData).then((response) => {
        expect(response.status).to.equal(201);
        customRuntimeGraphId = response.body.id;
      });
    });

    it('should run the custom runtime graph', () => {
      runGraph(customRuntimeGraphId).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('status', 'running');
      });
    });

    it('should execute shell command in alpine container', () => {
      const triggerData = {
        messages: ['Execute the shell command: uname -a'],
      };

      executeTrigger(customRuntimeGraphId, 'trigger-1', triggerData).then(
        (response) => {
          expect(response.status).to.equal(201);
          expect(response.body).to.have.property('threadId');
          expect(response.body).to.have.property('checkpointNs');
        },
      );
    });

    it('should cleanup custom runtime graph', () => {
      destroyGraph(customRuntimeGraphId).then((response) => {
        expect(response.status).to.equal(201);
      });

      deleteGraph(customRuntimeGraphId).then((response) => {
        expect(response.status).to.equal(200);
      });
    });
  });

  describe('Shell Command Error Handling', () => {
    let errorTestGraphId: string;

    before(() => {
      const graphData = createMockGraphDataWithShellTool();
      createGraph(graphData).then((response) => {
        errorTestGraphId = response.body.id;
        runGraph(errorTestGraphId);
      });
    });

    after(() => {
      destroyGraph(errorTestGraphId);
      deleteGraph(errorTestGraphId);
    });

    it('should handle invalid shell commands gracefully', () => {
      const triggerData = {
        messages: [
          'Execute this invalid command: invalidcommandthatdoesnotexist',
        ],
      };

      executeTrigger(errorTestGraphId, 'trigger-1', triggerData).then(
        (response) => {
          expect(response.status).to.equal(201);
          expect(response.body).to.have.property('threadId');
          expect(response.body).to.have.property('checkpointNs');
        },
      );
    });

    it('should handle command with non-zero exit code', () => {
      const triggerData = {
        messages: ['Execute this command that will fail: ls /nonexistentpath'],
      };

      executeTrigger(errorTestGraphId, 'trigger-1', triggerData).then(
        (response) => {
          expect(response.status).to.equal(201);
          expect(response.body).to.have.property('threadId');
          expect(response.body).to.have.property('checkpointNs');
        },
      );
    });
  });

  describe('Shell Command Timeout Functionality', () => {
    let timeoutTestGraphId: string;

    before(() => {
      const graphData = createMockGraphDataWithShellTool();
      createGraph(graphData).then((response) => {
        timeoutTestGraphId = response.body.id;
        runGraph(timeoutTestGraphId);
      });
    });

    after(() => {
      destroyGraph(timeoutTestGraphId);
      deleteGraph(timeoutTestGraphId);
    });

    it('should handle overall timeout for long-running commands', () => {
      const triggerData = {
        messages: ['Execute this command with a 2-second timeout: sleep 5'],
        threadSubId: 'timeout-test-1',
      };

      executeTrigger(timeoutTestGraphId, 'trigger-1', triggerData).then(
        (response) => {
          expect(response.status).to.equal(201);
          expect(response.body).to.have.property('threadId');
          expect(response.body).to.have.property('checkpointNs');

          // Wait a bit for the command to timeout
          cy.wait(3000);

          // Verify messages were created
          getNodeMessages(timeoutTestGraphId, 'agent-1', {
            threadId: response.body.threadId,
          }).then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(200);
            expect(messagesResponse.body.threads).to.be.an('array');
            expect(messagesResponse.body.threads.length).to.be.greaterThan(0);

            const thread = messagesResponse.body.threads[0];
            const messages = thread.messages;
            expect(messages.length).to.be.greaterThan(0);

            // Find the shell tool message
            const shellMessage = messages.find(
              (msg) => msg.role === 'tool-shell' && msg['name'] === 'shell',
            );
            expect(shellMessage).to.exist;

            // Verify shell message content structure
            const shellContent = shellMessage.content;
            expect(shellContent).to.be.an('object');
            expect(shellContent)
              .to.have.property('exitCode')
              .that.is.a('number');
            expect(shellContent).to.have.property('stdout').that.is.a('string');
            expect(shellContent).to.have.property('stderr').that.is.a('string');
            expect(shellContent).to.have.property('cmd').that.is.a('string');

            // The command should have timed out (exit code 124)
            expect(shellContent).to.have.property('exitCode', 124);
          });
        },
      );
    });

    it('should handle tail timeout for commands that stop producing output', () => {
      const triggerData = {
        messages: [
          'Execute this command that will stop producing output: echo "start"; sleep 3; echo "end"',
        ],
        threadSubId: 'tail-timeout-test-1',
      };

      executeTrigger(timeoutTestGraphId, 'trigger-1', triggerData).then(
        (response) => {
          expect(response.status).to.equal(201);
          expect(response.body).to.have.property('threadId');
          expect(response.body).to.have.property('checkpointNs');

          // Wait for the command to complete or timeout
          cy.wait(5000);

          // Verify messages were created
          getNodeMessages(timeoutTestGraphId, 'agent-1', {
            threadId: response.body.threadId,
          }).then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(200);
            expect(messagesResponse.body.threads).to.be.an('array');
            expect(messagesResponse.body.threads.length).to.be.greaterThan(0);

            const thread = messagesResponse.body.threads[0];
            const messages = thread.messages;
            expect(messages.length).to.be.greaterThan(0);

            // Find the shell tool message
            const shellMessage = messages.find(
              (msg) => msg.role === 'tool-shell' && msg['name'] === 'shell',
            );
            expect(shellMessage).to.exist;

            // Verify shell message content structure
            const shellContent = shellMessage.content;
            expect(shellContent).to.be.an('object');
            expect(shellContent)
              .to.have.property('exitCode')
              .that.is.a('number');
            expect(shellContent).to.have.property('stdout').that.is.a('string');
            expect(shellContent).to.have.property('stderr').that.is.a('string');
            expect(shellContent).to.have.property('cmd').that.is.a('string');

            // The command should have completed successfully (exit code 0)
            // since it produces output within the tail timeout
            expect(shellContent).to.have.property('exitCode', 0);
            expect((shellContent as any).stdout).to.contain('start');
            expect((shellContent as any).stdout).to.contain('end');
          });
        },
      );
    });

    it('should complete successfully when both timeouts are sufficient', () => {
      const triggerData = {
        messages: ['Execute this quick command: echo "success"'],
        threadSubId: 'success-test-1',
      };

      executeTrigger(timeoutTestGraphId, 'trigger-1', triggerData).then(
        (response) => {
          expect(response.status).to.equal(201);
          expect(response.body).to.have.property('threadId');
          expect(response.body).to.have.property('checkpointNs');

          // Wait for the command to complete
          cy.wait(2000);

          // Verify messages were created
          getNodeMessages(timeoutTestGraphId, 'agent-1', {
            threadId: response.body.threadId,
          }).then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(200);
            expect(messagesResponse.body.threads).to.be.an('array');
            expect(messagesResponse.body.threads.length).to.be.greaterThan(0);

            const thread = messagesResponse.body.threads[0];
            const messages = thread.messages;
            expect(messages.length).to.be.greaterThan(0);

            // Find the shell tool message
            const shellMessage = messages.find(
              (msg) => msg.role === 'tool-shell' && msg['name'] === 'shell',
            );
            expect(shellMessage).to.exist;

            // Verify shell message content structure
            const shellContent = shellMessage.content;
            expect(shellContent).to.be.an('object');
            expect(shellContent)
              .to.have.property('exitCode')
              .that.is.a('number');
            expect(shellContent).to.have.property('stdout').that.is.a('string');
            expect(shellContent).to.have.property('stderr').that.is.a('string');
            expect(shellContent).to.have.property('cmd').that.is.a('string');

            // The command should have completed successfully
            expect(shellContent).to.have.property('exitCode', 0);
            expect((shellContent as any).stdout).to.contain('success');
          });
        },
      );
    });
  });
});

// Helper function to create mock graph data with shell tool
function createMockGraphDataWithShellTool(options?: {
  dockerImage?: string;
  workdir?: string;
  env?: Record<string, string>;
}) {
  const baseGraphData = createMockGraphData();

  return {
    ...baseGraphData,
    name: `Shell Execution Test Graph ${crypto.randomUUID().slice(0, 8)}`,
    description: 'Test graph with docker runtime and shell tool',
    temporary: true, // E2E test graphs are temporary by default
    schema: {
      nodes: [
        {
          id: 'runtime-1',
          template: 'docker-runtime',
          config: {
            runtimeType: 'Docker',
            image: options?.dockerImage ?? 'node:20-alpine',
            workdir: options?.workdir ?? '/app',
            env: options?.env ?? {},
          },
        },
        {
          id: 'shell-tool-1',
          template: 'shell-tool',
          config: {
            runtimeNodeId: 'runtime-1',
          },
        },
        {
          id: 'agent-1',
          template: 'simple-agent',
          config: {
            name: 'Shell Executor Agent',
            instructions:
              'You are a shell command executor agent. When the user asks you to execute a shell command, you MUST use the shell tool to execute it. Always respond with the output from the shell tool.',
            invokeModelName: 'gpt-5-mini',
            toolNodeIds: ['shell-tool-1'],
          },
        },
        {
          id: 'trigger-1',
          template: 'manual-trigger',
          config: {
            agentId: 'agent-1',
          },
        },
      ],
      edges: [
        {
          from: 'trigger-1',
          to: 'agent-1',
        },
      ],
    },
    metadata: {
      nodes: [
        {
          id: 'runtime-1',
          template: 'docker-runtime',
          config: {
            runtimeType: 'Docker',
            image: options?.dockerImage ?? 'node:20-alpine',
            workdir: options?.workdir ?? '/app',
            env: options?.env ?? {},
          },
        },
        {
          id: 'shell-tool-1',
          template: 'shell-tool',
          config: {
            runtimeNodeId: 'runtime-1',
          },
        },
        {
          id: 'agent-1',
          template: 'simple-agent',
          config: {
            name: 'Shell Executor Agent',
            instructions:
              'You are a shell command executor agent. When the user asks you to execute a shell command, you MUST use the shell tool to execute it. Always respond with the output from the shell tool.',
            invokeModelName: 'gpt-5-mini',
            toolNodeIds: ['shell-tool-1'],
          },
        },
        {
          id: 'trigger-1',
          template: 'manual-trigger',
          config: {
            agentId: 'agent-1',
          },
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
}
