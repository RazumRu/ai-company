import {
  CreateGraphDto,
  ExecuteTriggerDto,
  ExecuteTriggerResponseDto,
  GraphDto,
  GraphNodeWithStatusDto,
  UpdateGraphDto,
} from '../../api-definitions';
import { GraphDtoSchema } from '../../api-definitions/schemas.gen';
import { generateRandomUUID, reqHeaders } from '../common.helper';
import { graphCleanup } from './graph-cleanup.helper';

export const createGraph = (data: CreateGraphDto, headers = reqHeaders) =>
  cy
    .request<GraphDto>({
      url: '/api/v1/graphs',
      method: 'POST',
      headers,
      body: data,
      failOnStatusCode: false,
    })
    .then((response) => {
      // Register the created graph for cleanup
      if (response.status === 201 && response.body?.id) {
        graphCleanup.registerGraph(response.body.id);
      }
      return response;
    });

export const getAllGraphs = (headers = reqHeaders) =>
  cy.request<GraphDto[]>({
    url: '/api/v1/graphs',
    method: 'GET',
    headers,
  });

export const getGraphById = (id: string, headers = reqHeaders) =>
  cy.request<GraphDto>({
    url: `/api/v1/graphs/${id}`,
    method: 'GET',
    headers,
    failOnStatusCode: false,
  });

export const getCompiledNodes = (
  id: string,
  query: { threadId?: string; runId?: string } = {},
  headers = reqHeaders,
) =>
  cy.request<GraphNodeWithStatusDto[]>({
    url: `/api/v1/graphs/${id}/nodes`,
    method: 'GET',
    headers,
    qs: query,
    failOnStatusCode: false,
    timeout: 60000,
  });

export const updateGraph = (
  id: string,
  data: UpdateGraphDto,
  headers = reqHeaders,
) =>
  cy.request<GraphDto>({
    url: `/api/v1/graphs/${id}`,
    method: 'PUT',
    headers,
    body: data,
    failOnStatusCode: false,
  });

export const deleteGraph = (id: string, headers = reqHeaders) =>
  cy
    .request({
      url: `/api/v1/graphs/${id}`,
      method: 'DELETE',
      headers,
      failOnStatusCode: false,
    })
    .then((response) => {
      // Unregister the graph from cleanup if successfully deleted
      if (response.status === 200) {
        graphCleanup.unregisterGraph(id);
      }
      return response;
    });

export const runGraph = (id: string, headers = reqHeaders) => {
  // Ensure the graph is registered for cleanup
  graphCleanup.registerGraph(id);

  return cy.request<GraphDto>({
    url: `/api/v1/graphs/${id}/run`,
    method: 'POST',
    headers,
    failOnStatusCode: false,
    timeout: 180000,
  });
};

export const stopGraph = (id: string, headers = reqHeaders) =>
  cy.request({
    url: `/api/v1/graphs/${id}/run`,
    method: 'DELETE',
    headers,
    failOnStatusCode: false,
  });

export const destroyGraph = (id: string, headers = reqHeaders) =>
  cy
    .request<GraphDto>({
      url: `/api/v1/graphs/${id}/destroy`,
      method: 'POST',
      headers,
      failOnStatusCode: false,
    })
    .then((response) => {
      // Unregister the graph from cleanup if successfully destroyed
      if (response.status === 201 || response.status === 200) {
        graphCleanup.unregisterGraph(id);
      }
      return response;
    });

export const executeTrigger = (
  graphId: string,
  triggerId: string,
  body: ExecuteTriggerDto,
  headers = reqHeaders,
  timeoutMs = 180000,
) =>
  cy.request<ExecuteTriggerResponseDto>({
    url: `/api/v1/graphs/${graphId}/triggers/${triggerId}/execute`,
    method: 'POST',
    headers,
    body,
    failOnStatusCode: false,
    timeout: timeoutMs,
  });

export const validateGraph = (data: GraphDto) => {
  cy.validateSchema(data, GraphDtoSchema);
};

export const waitForGraphToBeRunning = (
  id: string,
  headers = reqHeaders,
  timeoutMs = 60000,
) => {
  const startedAt = Date.now();

  const poll = (): Cypress.Chainable =>
    getGraphById(id, headers).then((response) => {
      expect(response.status).to.equal(200);

      if (response.body.status === 'running') {
        return undefined;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Graph ${id} did not reach running status within ${timeoutMs}ms (current status: ${response.body.status})`,
        );
      }

      return cy.wait(1000).then(() => poll());
    });

  return poll();
};

export const waitForGraphStatus = (
  id: string,
  expectedStatus: GraphDto['status'],
  headers = reqHeaders,
  timeoutMs = 60000,
) => {
  const startedAt = Date.now();

  const poll = (): Cypress.Chainable =>
    getGraphById(id, headers).then((response) => {
      expect(response.status).to.equal(200);

      if (response.body.status === expectedStatus) {
        return undefined;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Graph ${id} did not reach status ${expectedStatus} within ${timeoutMs}ms (current status: ${response.body.status})`,
        );
      }

      return cy.wait(1000).then(() => poll());
    });

  return poll();
};

export const waitForGraphToBeStopped = (
  id: string,
  headers = reqHeaders,
  timeoutMs = 60000,
) => waitForGraphStatus(id, 'stopped', headers, timeoutMs);

export const createMockGraphData = (
  overrides: Partial<CreateGraphDto> = {},
): CreateGraphDto => ({
  name: `Test Graph ${generateRandomUUID().slice(0, 8)}`,
  description: 'Test graph for e2e testing',
  temporary: true, // E2E test graphs are temporary by default
  schema: {
    nodes: [
      {
        id: 'agent-1',
        template: 'simple-agent',
        config: {
          name: 'Test Agent',
          instructions: 'You are a helpful test agent.',
          invokeModelName: 'gpt-5-mini',
          maxIterations: 10,
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
  ...overrides,
});

export const createMockUpdateData = (
  currentVersion: string,
  overrides: Partial<UpdateGraphDto> = {},
): UpdateGraphDto => ({
  name: `Updated Test Graph ${generateRandomUUID().slice(0, 8)}`,
  description: 'Updated test graph for e2e testing',
  currentVersion,
  ...overrides,
});
