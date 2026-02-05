import {
  CreateRepositoryDto,
  GetRepoIndexesData,
  GetRepositoriesData,
  GitRepositoryDto,
  RepoIndexDto,
  TriggerReindexDto,
  TriggerReindexResponseDto,
  UpdateRepositoryDto,
} from '../../api-definitions';
import { buildAuthHeaders, reqHeaders } from '../common.helper';

export const getGitRepositories = (
  query: GetRepositoriesData['query'] = {},
  headers = reqHeaders,
) => {
  return cy.request<GitRepositoryDto[]>({
    method: 'GET',
    url: '/api/v1/git-repositories',
    qs: query,
    headers: headers || buildAuthHeaders(),
    failOnStatusCode: false,
  });
};

export const getGitRepositoryById = (id: string, headers = reqHeaders) => {
  return cy.request<GitRepositoryDto>({
    method: 'GET',
    url: `/api/v1/git-repositories/${id}`,
    headers: headers || buildAuthHeaders(),
    failOnStatusCode: false,
  });
};

export const createGitRepository = (
  data: CreateRepositoryDto,
  headers = reqHeaders,
) => {
  return cy.request<GitRepositoryDto>({
    method: 'POST',
    url: '/api/v1/git-repositories',
    headers: headers || buildAuthHeaders(),
    body: data,
    failOnStatusCode: false,
  });
};

export const updateGitRepository = (
  id: string,
  data: UpdateRepositoryDto,
  headers = reqHeaders,
) => {
  return cy.request<GitRepositoryDto>({
    method: 'PATCH',
    url: `/api/v1/git-repositories/${id}`,
    headers: headers || buildAuthHeaders(),
    body: data,
    failOnStatusCode: false,
  });
};

export const deleteGitRepository = (id: string, headers = reqHeaders) => {
  return cy.request({
    method: 'DELETE',
    url: `/api/v1/git-repositories/${id}`,
    headers: headers || buildAuthHeaders(),
    failOnStatusCode: false,
  });
};

export const getRepoIndexes = (
  query: GetRepoIndexesData['query'] = {},
  headers = reqHeaders,
) => {
  return cy.request<RepoIndexDto[]>({
    method: 'GET',
    url: '/api/v1/git-repositories/indexes',
    qs: query,
    headers: headers || buildAuthHeaders(),
    failOnStatusCode: false,
  });
};

export const getRepoIndexByRepositoryId = (
  id: string,
  headers = reqHeaders,
) => {
  return cy.request<RepoIndexDto | null>({
    method: 'GET',
    url: `/api/v1/git-repositories/${id}/index`,
    headers: headers || buildAuthHeaders(),
    failOnStatusCode: false,
  });
};

export const triggerReindex = (
  data: TriggerReindexDto,
  headers = reqHeaders,
) => {
  return cy.request<TriggerReindexResponseDto>({
    method: 'POST',
    url: '/api/v1/git-repositories/reindex',
    headers: headers || buildAuthHeaders(),
    body: data,
    failOnStatusCode: false,
  });
};
