import { LiteLlmModelDto } from '../../api-definitions';
import { reqHeaders } from '../common.helper';

export const getModels = (headers = reqHeaders) =>
  cy.request<LiteLlmModelDto[]>({
    url: '/api/v1/litellm/models',
    method: 'GET',
    headers,
  });
