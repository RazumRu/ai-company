import {
  CreateProjectDto,
  ProjectDto,
  UpdateProjectDto,
} from '../../api-definitions';
import { generateRandomUUID, reqHeaders } from '../common.helper';

export const createProject = (
  data: CreateProjectDto,
  headers = reqHeaders,
) =>
  cy.request<ProjectDto>({
    url: '/api/v1/projects',
    method: 'POST',
    headers,
    body: data,
    failOnStatusCode: false,
  });

export const getAllProjects = (headers = reqHeaders) =>
  cy.request<ProjectDto[]>({
    url: '/api/v1/projects',
    method: 'GET',
    headers,
    failOnStatusCode: false,
  });

export const getProjectById = (id: string, headers = reqHeaders) =>
  cy.request<ProjectDto>({
    url: `/api/v1/projects/${id}`,
    method: 'GET',
    headers,
    failOnStatusCode: false,
  });

export const updateProject = (
  id: string,
  data: UpdateProjectDto,
  headers = reqHeaders,
) =>
  cy.request<ProjectDto>({
    url: `/api/v1/projects/${id}`,
    method: 'PUT',
    headers,
    body: data,
    failOnStatusCode: false,
  });

export const deleteProject = (id: string, headers = reqHeaders) =>
  cy.request<void>({
    url: `/api/v1/projects/${id}`,
    method: 'DELETE',
    headers,
    failOnStatusCode: false,
  });

export const createTestProject = (headers = reqHeaders) =>
  createProject(
    {
      name: `Test Project ${generateRandomUUID().slice(0, 8)}`,
      description: 'E2E test project',
    },
    headers,
  ).then((response) => {
    expect(response.status).to.equal(201);
    return response.body.id;
  });
