import {
  KnowledgeContentSuggestionRequestDto,
  KnowledgeContentSuggestionResponseDto,
  KnowledgeDocDto,
  KnowledgeDocInputDto,
} from '../../api-definitions';
import { reqHeaders } from '../common.helper';

export const createKnowledgeDoc = (
  data: KnowledgeDocInputDto,
  headers = reqHeaders,
) =>
  cy.request<KnowledgeDocDto>({
    url: '/api/v1/knowledge-docs',
    method: 'POST',
    headers,
    body: data,
    failOnStatusCode: false,
  });

export const updateKnowledgeDoc = (
  id: string,
  data: KnowledgeDocInputDto,
  headers = reqHeaders,
) =>
  cy.request<KnowledgeDocDto>({
    url: `/api/v1/knowledge-docs/${id}`,
    method: 'PUT',
    headers,
    body: data,
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

export const deleteKnowledgeDoc = (id: string, headers = reqHeaders) =>
  cy.request({
    url: `/api/v1/knowledge-docs/${id}`,
    method: 'DELETE',
    headers,
    failOnStatusCode: false,
  });

export const suggestKnowledgeContent = (
  payload: KnowledgeContentSuggestionRequestDto,
  headers = reqHeaders,
) =>
  cy.request<KnowledgeContentSuggestionResponseDto>({
    url: '/api/v1/knowledge-docs/suggest',
    method: 'POST',
    headers,
    body: payload,
    failOnStatusCode: false,
    timeout: 300_000,
  });
