import type {
  GraphNodeWithStatusDto,
  ThreadMessageDto,
} from '../../api-definitions';
import {
  getThreadByExternalId,
  getThreadMessages,
} from '../threads/threads.helper';
import { graphCleanup } from './graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  destroyGraph,
  executeTrigger,
  getCompiledNodes,
  runGraph,
} from './graphs.helper';

const ALLOWED_STATUSES: GraphNodeWithStatusDto['status'][] = [
  'idle',
  'running',
  'starting',
  'stopped',
];

const extractRunId = (messages: ThreadMessageDto[]): string | undefined => {
  for (const entry of messages) {
    const additionalKwargs =
      (entry.message as { additionalKwargs?: Record<string, unknown> })
        .additionalKwargs ?? {};
    const runId = additionalKwargs['run_id'];

    if (typeof runId === 'string' && runId.length > 0) {
      return runId;
    }
  }

  return undefined;
};

describe('Graph Nodes API E2E', () => {
  after(() => {
    graphCleanup.cleanupAllGraphs();
  });

  it('should return 400 when requesting nodes for a graph that is not running', () => {
    const graphData = createMockGraphData();

    return createGraph(graphData).then((createResponse) => {
      expect(createResponse.status).to.equal(201);
      const graphId = createResponse.body.id;

      return getCompiledNodes(graphId).then((nodesResponse) => {
        expect(nodesResponse.status).to.equal(400);
        const errorBody = nodesResponse.body as unknown as {
          message?: string;
        };
        expect(errorBody).to.have.property('message');
      });
    });
  });

  it('should return compiled node snapshots for a running graph', () => {
    const graphData = createMockGraphData();
    let graphId: string;

    return createGraph(graphData)
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        graphId = createResponse.body.id;

        return runGraph(graphId);
      })
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);

        return getCompiledNodes(graphId);
      })
      .then((nodesResponse) => {
        expect(nodesResponse.status).to.equal(200);
        const nodes = nodesResponse.body;

        expect(nodes).to.be.an('array').and.to.have.length.greaterThan(0);
        const nodeIds = nodes.map((node) => node.id);
        expect(nodeIds).to.include('agent-1');
        expect(nodeIds).to.include('trigger-1');

        nodes.forEach((node) => {
          expect(node.status).to.be.oneOf(ALLOWED_STATUSES);
          if (node.error !== undefined && node.error !== null) {
            expect(node.error).to.be.a('string');
          }
        });

        // Metadata should not be present when no filter is provided
        nodes.forEach((node) => {
          expect(node.metadata, `${node.id} metadata`).to.be.undefined;
        });

        return destroyGraph(graphId);
      })
      .then((destroyResponse) => {
        expect([200, 201]).to.include(destroyResponse.status);
      });
  });

  it('should provide filtered node snapshots by thread and run identifiers', function () {
    this.timeout(120000);

    const graphData = createMockGraphData();
    let graphId: string;
    let threadId: string;
    let internalThreadId: string;
    let runId: string;
    let extractedRunId: string | undefined;

    return createGraph(graphData)
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        graphId = createResponse.body.id;

        return runGraph(graphId);
      })
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);

        return getCompiledNodes(graphId);
      })
      .then((initialNodesResponse) => {
        expect(initialNodesResponse.status).to.equal(200);
        const agentNode = initialNodesResponse.body.find(
          (node) => node.id === 'agent-1',
        );
        expect(agentNode).to.exist;
        expect(agentNode?.status).to.be.oneOf(ALLOWED_STATUSES);

        return executeTrigger(graphId, 'trigger-1', {
          messages: [
            'Please summarize this message concisely and confirm completion.',
          ],
          threadSubId: 'node-status-thread',
          async: false,
        });
      })
      .then((triggerResponse) => {
        expect(triggerResponse.status).to.equal(201);
        threadId = triggerResponse.body.externalThreadId;
        expect(threadId).to.be.a('string').and.not.to.be.empty;
      })
      .then(() => getThreadByExternalId(threadId))
      .then((threadResponse) => {
        expect(threadResponse.status).to.equal(200);
        internalThreadId = threadResponse.body.id;
        expect(internalThreadId).to.be.a('string').and.not.to.be.empty;

        return getThreadMessages(internalThreadId);
      })
      .then((messagesResponse) => {
        expect(messagesResponse.status).to.equal(200);
        extractedRunId = extractRunId(messagesResponse.body) ?? undefined;

        return getCompiledNodes(graphId, { threadId });
      })
      .then((threadFilteredResponse) => {
        expect(threadFilteredResponse.status).to.equal(200);
        const threadNode = threadFilteredResponse.body.find(
          (node) => node.id === 'agent-1',
        );
        expect(threadNode).to.exist;
        expect(threadNode?.metadata?.threadId).to.equal(threadId);
        expect(threadNode?.status).to.be.oneOf(ALLOWED_STATUSES);

        const metadataRunId = threadNode?.metadata?.runId;
        runId = metadataRunId ?? extractedRunId ?? '';
        expect(runId, 'runId from metadata or messages').to.be.a('string').and
          .not.to.be.empty;

        return getCompiledNodes(graphId, { runId });
      })
      .then((runFilteredResponse) => {
        expect(runFilteredResponse.status).to.equal(200);
        const runNode = runFilteredResponse.body.find(
          (node) => node.id === 'agent-1',
        );
        expect(runNode).to.exist;
        expect(runNode?.metadata?.runId).to.equal(runId);
        expect(runNode?.status).to.be.oneOf(ALLOWED_STATUSES);

        return destroyGraph(graphId);
      })
      .then((destroyResponse) => {
        expect([200, 201]).to.include(destroyResponse.status);

        return getCompiledNodes(graphId).then((afterDestroyResponse) => {
          expect(afterDestroyResponse.status).to.equal(400);
        });
      });
  });
});
