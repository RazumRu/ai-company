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

describe('Docker-in-Docker E2E', () => {
  let dindGraphId: string;

  // Cleanup after all tests in this describe block
  after(() => {
    graphCleanup.cleanupAllGraphs();
  });

  describe('Docker-in-Docker Functionality (Always Enabled)', () => {
    it('should create a graph with docker runtime and shell tool', () => {
      const graphData = createMockGraphDataWithDockerInDocker();

      createGraph(graphData).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('id');
        expect(response.body).to.have.property('status', 'created');
        dindGraphId = response.body.id;
      });
    });

    it('should run the graph', () => {
      runGraph(dindGraphId).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('status', 'running');
      });
    });

    it('should verify docker socket is mounted', () => {
      const testCommand =
        'Use the shell tool to execute this command: ls -la /var/run/ && echo "---" && (test -S /var/run/docker.sock && echo "Socket exists" || echo "Socket not found")';
      const triggerData = {
        messages: [testCommand],
        threadSubId: 'docker-socket-test',
      };

      executeTrigger(dindGraphId, 'trigger-1', triggerData).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('threadId');
        expect(response.body).to.have.property('checkpointNs');

        // Wait for command execution
        cy.wait(3000);

        // Verify messages were created
        getNodeMessages(dindGraphId, 'agent-1', {
          threadId: response.body.threadId,
        }).then((messagesResponse) => {
          expect(messagesResponse.status).to.equal(200);
          expect(messagesResponse.body.threads).to.be.an('array');
          expect(messagesResponse.body.threads.length).to.be.greaterThan(0);

          const thread = messagesResponse.body.threads[0];
          expect(thread).to.exist;
          expect(thread.messages).to.be.an('array');
          const messages = thread.messages;

          // Find the shell tool message
          const shellMessage = messages.find(
            (msg) => msg.role === 'tool-shell' && msg['name'] === 'shell',
          );

          expect(shellMessage).to.exist;

          const shellContent = shellMessage.content;

          // Check if output confirms socket exists (should show in listing)
          const output = String(shellContent['stdout']);
          expect(output).to.satisfy(
            (content: string) =>
              content.includes('Socket exists') ||
              content.includes('docker.sock'),
            'Shell output should show docker.sock exists',
          );
        });
      });
    });

    it('should be able to use docker commands with mounted socket', () => {
      const testCommand =
        'Use the shell tool to execute this command: docker ps';
      const triggerData = {
        messages: [testCommand],
        threadSubId: 'docker-ps-test',
      };

      executeTrigger(dindGraphId, 'trigger-1', triggerData).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('threadId');
        expect(response.body).to.have.property('checkpointNs');

        // Wait for docker command execution
        cy.wait(5000);

        // Verify messages were created
        getNodeMessages(dindGraphId, 'agent-1', {
          threadId: response.body.threadId,
        }).then((messagesResponse) => {
          expect(messagesResponse.status).to.equal(200);
          expect(messagesResponse.body.threads).to.be.an('array');
          expect(messagesResponse.body.threads.length).to.be.greaterThan(0);

          const thread = messagesResponse.body.threads[0];
          expect(thread).to.exist;
          expect(thread.messages).to.be.an('array');
          const messages = thread.messages;

          // Find the shell tool message
          const shellMessage = messages.find(
            (msg) => msg.role === 'tool-shell' && msg['name'] === 'shell',
          );

          expect(shellMessage).to.exist;

          const shellContent = shellMessage.content;

          // Docker ps should work (exit code 0)
          expect(shellContent).to.have.property('exitCode', 0);

          // Output should contain docker ps headers
          const output = String(shellContent['stdout']);
          expect(output).to.satisfy(
            (content: string) =>
              content.includes('CONTAINER') || content.includes('IMAGE'),
            'Docker ps output should show container list headers',
          );
        });
      });
    });

    it('should destroy the running graph', () => {
      destroyGraph(dindGraphId).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('status', 'stopped');
      });
    });

    it('should delete the graph', () => {
      deleteGraph(dindGraphId).then((response) => {
        expect(response.status).to.equal(200);
      });
    });
  });
});

// Helper function to create mock graph data with Docker-in-Docker enabled
function createMockGraphDataWithDockerInDocker() {
  const baseGraphData = createMockGraphData();

  return {
    ...baseGraphData,
    name: `Docker-in-Docker Test Graph ${crypto.randomUUID().slice(0, 8)}`,
    description: 'Test graph with docker-in-docker support (always enabled)',
    temporary: true,
    schema: {
      nodes: [
        {
          id: 'runtime-1',
          template: 'docker-runtime',
          config: {
            runtimeType: 'Docker',
            image: 'node:20-alpine',
            workdir: '/app',
            env: {},
            initScript: 'apk add --no-cache docker-cli',
            initScriptTimeoutMs: 60000,
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
            name: 'Docker-in-Docker Test Agent',
            instructions:
              'You are a shell command executor agent. When the user asks you to execute a command, you MUST use the shell tool to execute it. Always respond with the output from the shell tool.',
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
            image: 'node:20-alpine',
            workdir: '/app',
            env: {},
            initScript: 'apk add --no-cache docker-cli',
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
            name: 'Docker-in-Docker Test Agent',
            instructions:
              'You are a shell command executor agent. When the user asks you to execute a command, you MUST use the shell tool to execute it. Always respond with the output from the shell tool.',
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
