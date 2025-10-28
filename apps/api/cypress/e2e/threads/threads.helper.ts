import type { ThreadDto } from '../../api-definitions/types.gen';
import { reqHeaders } from '../common.helper';

export const getThreads = (
  query: { graphId: string; limit?: number; offset?: number },
  headers = reqHeaders,
) =>
  cy.request<ThreadDto[]>({
    url: '/api/v1/threads',
    method: 'GET',
    headers,
    qs: query,
    failOnStatusCode: false,
  });

export const getThreadById = (threadId: string, headers = reqHeaders) =>
  cy.request<ThreadDto>({
    url: `/api/v1/threads/${threadId}`,
    method: 'GET',
    headers,
    failOnStatusCode: false,
  });

export const getThreadByExternalId = (
  externalThreadId: string,
  headers = reqHeaders,
) =>
  cy.request<ThreadDto>({
    url: `/api/v1/threads/external/${externalThreadId}`,
    method: 'GET',
    headers,
    failOnStatusCode: false,
  });

export const deleteThread = (threadId: string, headers = reqHeaders) =>
  cy.request({
    url: `/api/v1/threads/${threadId}`,
    method: 'DELETE',
    headers,
    failOnStatusCode: false,
  });
