/**
 * Daytona Runtime E2E tests.
 *
 * IMPORTANT: The API server must be running with DEFAULT_RUNTIME_TYPE=Daytona
 * for this test to exercise Daytona. The `runtimeType` field in runtime node
 * config is stripped by `RuntimeTemplate.strip()`, so the server-level default
 * determines which runtime backend is used.
 */

import type { ThreadMessageDto } from '../../api-definitions/types.gen';
import { graphCleanup } from '../graphs/graph-cleanup.helper';
import {
  createGraph,
  executeTrigger,
  runGraph,
  waitForGraphToBeRunning,
} from '../graphs/graphs.helper';
import {
  getThreadByExternalId,
  getThreadMessages,
  waitForThreadStatus,
} from '../threads/threads.helper';

const GRAPH_DATA = {
  name: `Daytona Runtime E2E ${Math.random().toString(36).slice(0, 8)}`,
  description: 'E2E test graph for Daytona runtime file create/edit via shell',
  temporary: true,
  schema: {
    nodes: [
      {
        id: 'trigger-1',
        template: 'manual-trigger',
        config: {},
      },
      {
        id: 'agent-1',
        template: 'simple-agent',
        config: {
          name: 'Daytona File Agent',
          description: 'Agent that creates and edits files via shell',
          instructions:
            'When asked to create or edit a file, use the shell tool to do so directly with echo/sed commands.',
          invokeModelName: 'gpt-5-mini',
          maxIterations: 50,
        },
      },
      {
        id: 'shell-1',
        template: 'shell-tool',
        config: {},
      },
      {
        id: 'runtime-1',
        template: 'runtime',
        config: {},
      },
    ],
    edges: [
      { from: 'trigger-1', to: 'agent-1' },
      { from: 'agent-1', to: 'shell-1' },
      { from: 'shell-1', to: 'runtime-1' },
    ],
  },
};

/** Extract shell tool messages from thread messages. */
const getShellToolMessages = (messages: ThreadMessageDto[]) =>
  messages.filter((entry) => {
    const msg = entry.message as Record<string, unknown>;
    return msg.role === 'tool' && msg.name === 'shell';
  });

describe('Daytona Runtime E2E', () => {
  let graphId: string;

  after(() => {
    graphCleanup.cleanupAllGraphs();
  });

  it('creates a file in the Daytona sandbox via shell tool', () => {
    createGraph(GRAPH_DATA)
      .then((response) => {
        expect(response.status).to.equal(201);
        graphId = response.body.id;
        return runGraph(graphId);
      })
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);
        return waitForGraphToBeRunning(graphId);
      })
      .then(() => {
        return executeTrigger(graphId, 'trigger-1', {
          messages: [
            "Create a file at /tmp/e2e-test.txt with the content 'hello daytona'",
          ],
        });
      })
      .then((triggerResponse) => {
        expect(triggerResponse.status).to.equal(201);
        const externalThreadId = triggerResponse.body.externalThreadId;

        return waitForThreadStatus(externalThreadId, ['done', 'stopped'], 40, 5000).then(
          () => getThreadByExternalId(externalThreadId),
        );
      })
      .then((threadResponse) => {
        expect(threadResponse.status).to.equal(200);
        const internalThreadId = threadResponse.body.id;

        return getThreadMessages(internalThreadId);
      })
      .then((messagesResponse) => {
        expect(messagesResponse.status).to.equal(200);

        const shellMessages = getShellToolMessages(messagesResponse.body);
        expect(shellMessages.length).to.be.greaterThan(0);

        // Verify at least one shell tool call succeeded (exitCode === 0)
        const successfulShellCall = shellMessages.find((entry) => {
          const content = (entry.message as Record<string, unknown>)
            .content as Record<string, unknown>;
          return content.exitCode === 0;
        });
        expect(successfulShellCall, 'expected at least one successful shell call').to
          .exist;
      });
  });

  it('edits a file in the Daytona sandbox via shell tool', () => {
    // This test reuses the same graph that was created and started above
    executeTrigger(graphId, 'trigger-1', {
      messages: [
        "Edit /tmp/e2e-test.txt and replace 'hello daytona' with 'hello edited daytona'",
      ],
      threadSubId: 'e2e-edit-file',
    })
      .then((triggerResponse) => {
        expect(triggerResponse.status).to.equal(201);
        const externalThreadId = triggerResponse.body.externalThreadId;

        return waitForThreadStatus(externalThreadId, ['done', 'stopped'], 40, 5000).then(
          () => getThreadByExternalId(externalThreadId),
        );
      })
      .then((threadResponse) => {
        expect(threadResponse.status).to.equal(200);
        const internalThreadId = threadResponse.body.id;

        return getThreadMessages(internalThreadId);
      })
      .then((messagesResponse) => {
        expect(messagesResponse.status).to.equal(200);

        const shellMessages = getShellToolMessages(messagesResponse.body);
        expect(shellMessages.length).to.be.greaterThan(0);

        // Verify at least one shell tool call succeeded
        const successfulShellCall = shellMessages.find((entry) => {
          const content = (entry.message as Record<string, unknown>)
            .content as Record<string, unknown>;
          return content.exitCode === 0;
        });
        expect(successfulShellCall, 'expected at least one successful shell call').to
          .exist;
      });
  });
});
