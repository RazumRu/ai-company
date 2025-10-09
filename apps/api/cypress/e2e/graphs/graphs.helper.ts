import {
  CreateGraphDto,
  GraphDto,
  UpdateGraphDto,
} from '../../api-definitions';
import {
  CreateGraphDtoSchema,
  GraphDtoSchema,
  UpdateGraphDtoSchema,
} from '../../api-definitions/schemas.gen';
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
  });
};

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

export const validateGraph = (data: GraphDto) => {
  cy.validateSchema(data, GraphDtoSchema);
};

export const createMockGraphData = (
  overrides: Partial<CreateGraphDto> = {},
): CreateGraphDto => ({
  name: `Test Graph ${generateRandomUUID().slice(0, 8)}`,
  description: 'Test graph for e2e testing',
  version: '1.0.0',
  schema: {
    nodes: [
      {
        id: 'agent-1',
        template: 'simple-agent',
        config: {
          name: 'Test Agent',
          instructions: 'You are a helpful test agent.',
          invokeModelName: 'gpt-4',
          invokeModelTemperature: 0.7,
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
    metadata: {
      graphId: generateRandomUUID(),
      name: 'Test Graph',
      version: '1.0.0',
    },
  },
  metadata: {
    nodes: [
      {
        id: 'agent-1',
        template: 'simple-agent',
        config: {
          name: 'Test Agent',
          instructions: 'You are a helpful test agent.',
          invokeModelName: 'gpt-4',
          invokeModelTemperature: 0.7,
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
  ...overrides,
});

export const createMockUpdateData = (
  overrides: Partial<UpdateGraphDto> = {},
): UpdateGraphDto => ({
  name: `Updated Test Graph ${generateRandomUUID().slice(0, 8)}`,
  description: 'Updated test graph for e2e testing',
  ...overrides,
});
