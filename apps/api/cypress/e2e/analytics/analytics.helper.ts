import type {
  AnalyticsByGraphResponseDto,
  AnalyticsOverviewDto,
  GetByGraphData,
  GetOverviewData,
} from '../../api-definitions';
import { reqHeaders } from '../common.helper';

export const getAnalyticsOverview = (
  query?: GetOverviewData['query'],
  headers = reqHeaders,
) =>
  cy.request<AnalyticsOverviewDto>({
    url: '/api/v1/analytics/overview',
    method: 'GET',
    headers,
    qs: query,
    failOnStatusCode: false,
  });

export const getAnalyticsByGraph = (
  query?: GetByGraphData['query'],
  headers = reqHeaders,
) =>
  cy.request<AnalyticsByGraphResponseDto>({
    url: '/api/v1/analytics/by-graph',
    method: 'GET',
    headers,
    qs: query,
    failOnStatusCode: false,
  });
