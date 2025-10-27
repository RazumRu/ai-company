import {
  getThreadByExternalId,
  getThreadMessages,
} from '../threads/threads.helper';
import { graphCleanup } from './graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  deleteGraph,
  destroyGraph,
  executeTrigger,
  runGraph,
} from './graphs.helper';

describe('Docker-in-Docker E2E', () => {
  let dindGraphId: string;

  // Cleanup after all tests in this describe block
  after(() => {
    graphCleanup.cleanupAllGraphs();
  });

  describe('Docker-in-Docker Functionality with Separate DIND Container', () => {
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

    it('should be able to use docker commands with DIND container', () => {
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

        // Verify messages were created via threads API
        getThreadByExternalId(response.body.threadId)
          .then((threadRes) => {
            expect(threadRes.status).to.equal(200);
            return getThreadMessages(threadRes.body.id);
          })
          .then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(200);
            expect(messagesResponse.body).to.be.an('array');
            expect(messagesResponse.body.length).to.be.greaterThan(0);

            const messages = messagesResponse.body.map((m) => m.message);

            // Verify the human message exists first
            const humanMessage = messages.find((msg) => msg.role === 'human');
            expect(humanMessage).to.exist;
            expect(humanMessage?.content).to.equal(testCommand);

            // Find the shell tool message
            const shellMessage = messages.find(
              (msg) => msg.role === 'tool-shell' && msg['name'] === 'shell',
            );

            expect(shellMessage).to.exist;

            const shellContent = shellMessage?.content;

            // Docker ps should work (exit code 0)
            expect(shellContent).to.have.property('exitCode', 0);

            // Output should contain docker ps headers
            const output = String(shellContent?.['stdout']);
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
  return createMockGraphData({
    name: `Docker-in-Docker Test Graph ${crypto.randomUUID().slice(0, 8)}`,
    description:
      'Test graph with docker-in-docker support using separate DIND container',
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
            enableDind: true,
          },
        },
        {
          id: 'shell-tool-1',
          template: 'shell-tool',
          config: {},
        },
        {
          id: 'agent-1',
          template: 'simple-agent',
          config: {
            name: 'Docker-in-Docker Test Agent',
            instructions:
              'You are a shell command executor agent. When the user asks you to execute a command, you MUST use the shell tool to execute it. Always respond with the output from the shell tool.',
            invokeModelName: 'gpt-5-mini',
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
        {
          from: 'agent-1',
          to: 'shell-tool-1',
        },
        {
          from: 'shell-tool-1',
          to: 'runtime-1',
        },
      ],
    },
  });
}
