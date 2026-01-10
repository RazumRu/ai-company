import type {
  ThreadDto,
  ThreadMessageDto,
  ThreadUsageStatisticsDto,
} from '../../api-definitions/types.gen';
import { reqHeaders } from '../common.helper';

export const getThreadMessages = (
  threadId: string,
  query: { limit?: number; offset?: number; nodeId?: string } = {},
  headers = reqHeaders,
) =>
  cy.request<ThreadMessageDto[]>({
    url: `/api/v1/threads/${threadId}/messages`,
    method: 'GET',
    headers,
    qs: query,
    failOnStatusCode: false,
  });

export const getThreads = (
  query?: { graphId?: string; limit?: number; offset?: number },
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

export const stopThread = (threadId: string, headers = reqHeaders) =>
  cy.request<ThreadDto>({
    url: `/api/v1/threads/${threadId}/stop`,
    method: 'POST',
    headers,
    failOnStatusCode: false,
  });

export const stopThreadByExternalId = (
  externalThreadId: string,
  headers = reqHeaders,
) =>
  cy.request<ThreadDto>({
    url: `/api/v1/threads/external/${externalThreadId}/stop`,
    method: 'POST',
    headers,
    failOnStatusCode: false,
  });

export const getThreadUsageStatistics = (
  threadId: string,
  headers = reqHeaders,
) =>
  cy.request<ThreadUsageStatisticsDto>({
    url: `/api/v1/threads/${threadId}/usage-statistics`,
    method: 'GET',
    headers,
    failOnStatusCode: false,
  });

export const waitForThreadStatus = (
  externalThreadId: string,
  expectedStatus: ThreadDto['status'] | ThreadDto['status'][],
  retries = 10,
  delayMs = 3000,
  headers = reqHeaders,
): Cypress.Chainable<Cypress.Response<ThreadDto>> => {
  if (retries <= 0) {
    throw new Error(
      `Thread '${externalThreadId}' did not reach status '${Array.isArray(expectedStatus) ? expectedStatus.join(', ') : expectedStatus}' within the expected time`,
    );
  }

  const expectedStatuses = Array.isArray(expectedStatus)
    ? expectedStatus
    : [expectedStatus];

  return getThreadByExternalId(externalThreadId, headers).then(
    (threadResponse): Cypress.Chainable<Cypress.Response<ThreadDto>> => {
      if (threadResponse.status === 404) {
        return cy
          .wait(delayMs)
          .then(() =>
            waitForThreadStatus(
              externalThreadId,
              expectedStatus,
              retries - 1,
              delayMs,
              headers,
            ),
          );
      }

      expect(threadResponse.status).to.equal(200);

      if (expectedStatuses.includes(threadResponse.body.status)) {
        return cy.wrap(threadResponse);
      }

      return cy
        .wait(delayMs)
        .then(() =>
          waitForThreadStatus(
            externalThreadId,
            expectedStatus,
            retries - 1,
            delayMs,
            headers,
          ),
        );
    },
  );
};
