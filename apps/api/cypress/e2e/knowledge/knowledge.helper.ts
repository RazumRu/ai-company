import { KnowledgeDocDto } from '../../api-definitions';
import { reqHeaders } from '../common.helper';

export const createKnowledgeDoc = (content: string, headers = reqHeaders) =>
  cy.request<KnowledgeDocDto>({
    url: '/api/v1/knowledge-docs',
    method: 'POST',
    headers,
    body: { content },
    failOnStatusCode: false,
  });

export const updateKnowledgeDoc = (
  id: string,
  content: string,
  headers = reqHeaders,
) =>
  cy.request<KnowledgeDocDto>({
    url: `/api/v1/knowledge-docs/${id}`,
    method: 'PUT',
    headers,
    body: { content },
    failOnStatusCode: false,
  });

export const getKnowledgeDoc = (id: string, headers = reqHeaders) =>
  cy.request<KnowledgeDocDto>({
    url: `/api/v1/knowledge-docs/${id}`,
    method: 'GET',
    headers,
    failOnStatusCode: false,
  });

export const listKnowledgeDocs = (
  query?: { search?: string; tags?: string[]; limit?: number; offset?: number },
  headers = reqHeaders,
) =>
  cy.request<KnowledgeDocDto[]>({
    url: '/api/v1/knowledge-docs',
    method: 'GET',
    headers,
    qs: query,
    failOnStatusCode: false,
  });

export const getKnowledgeChunks = (id: string, headers = reqHeaders) =>
  cy.request<KnowledgeDocDto[]>({
    url: `/api/v1/knowledge-docs/${id}/chunks`,
    method: 'GET',
    headers,
    failOnStatusCode: false,
  });

export const deleteKnowledgeDoc = (id: string, headers = reqHeaders) =>
  cy.request({
    url: `/api/v1/knowledge-docs/${id}`,
    method: 'DELETE',
    headers,
    failOnStatusCode: false,
  });
