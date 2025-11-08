import { GraphRevisionDto } from '../../api-definitions';
import { reqHeaders } from '../common.helper';

export const getGraphRevisions = (
  graphId: string,
  query: { status?: GraphRevisionDto['status'] } = {},
  headers = reqHeaders,
) =>
  cy.request<GraphRevisionDto[]>({
    url: `/api/v1/graphs/${graphId}/revisions`,
    method: 'GET',
    headers,
    qs: query,
    failOnStatusCode: false,
  });

export const getGraphRevisionById = (
  graphId: string,
  revisionId: string,
  headers = reqHeaders,
) =>
  cy.request<GraphRevisionDto>({
    url: `/api/v1/graphs/${graphId}/revisions/${revisionId}`,
    method: 'GET',
    headers,
    failOnStatusCode: false,
  });

type WaitForRevisionStatusOptions = {
  timeout?: number;
  interval?: number;
  allowHigherStatus?: boolean;
};

const STATUS_PRIORITY: Record<GraphRevisionDto['status'], number> = {
  pending: 0,
  applying: 1,
  applied: 2,
  failed: 3,
};

export const waitForRevisionStatus = (
  graphId: string,
  revisionId: string,
  expectedStatus: GraphRevisionDto['status'],
  options: WaitForRevisionStatusOptions = {},
): Cypress.Chainable<GraphRevisionDto> => {
  const {
    timeout = 60000,
    interval = 3000,
    allowHigherStatus = false,
  } = options;
  const deadline = Date.now() + timeout;

  const isAcceptableStatus = (status: GraphRevisionDto['status']) => {
    if (status === expectedStatus) {
      return true;
    }

    if (!allowHigherStatus) {
      return false;
    }

    if (expectedStatus === 'failed' || status === 'failed') {
      return false;
    }

    return STATUS_PRIORITY[status] > STATUS_PRIORITY[expectedStatus];
  };

  const checkStatus = (): Cypress.Chainable<GraphRevisionDto> =>
    getGraphRevisionById(graphId, revisionId).then((response) => {
      expect(response.status).to.equal(200);

      const currentStatus = response.body.status;

      if (isAcceptableStatus(currentStatus)) {
        return cy.wrap<GraphRevisionDto>(response.body);
      }

      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for revision ${revisionId} to reach status ${expectedStatus}. Last status: ${currentStatus}`,
        );
      }

      return cy.wait(interval).then(() => checkStatus());
    });

  return checkStatus();
};
