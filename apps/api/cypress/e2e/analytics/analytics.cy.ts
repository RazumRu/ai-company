import { buildAuthHeaders, generateRandomUUID } from '../common.helper';
import { graphCleanup } from '../graphs/graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  executeTrigger,
  runGraph,
  waitForGraphToBeRunning,
} from '../graphs/graphs.helper';
import { waitForThreadStatus } from '../threads/threads.helper';
import { getAnalyticsByGraph, getAnalyticsOverview } from './analytics.helper';

describe('Analytics E2E', () => {
  after(() => {
    graphCleanup.cleanupAllGraphs();
  });

  describe('GET /v1/analytics/overview', () => {
    it('should return 200 with valid analytics shape', () => {
      getAnalyticsOverview().then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.have.property('totalThreads');
        expect(response.body).to.have.property('totalTokens');
        expect(response.body).to.have.property('totalPrice');
        expect(response.body).to.have.property('inputTokens');
        expect(response.body).to.have.property('outputTokens');
        expect(response.body).to.have.property('cachedInputTokens');
        expect(response.body).to.have.property('reasoningTokens');

        expect(response.body.totalThreads).to.be.a('number');
        expect(response.body.totalTokens).to.be.a('number');
        expect(response.body.totalPrice).to.be.a('number');
      });
    });

    it('should accept date range query parameters', () => {
      getAnalyticsOverview({
        dateFrom: '2020-01-01T00:00:00Z',
        dateTo: '2099-12-31T23:59:59Z',
      }).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body.totalThreads).to.be.a('number');
      });
    });

    it('should return zero totals for future date range', () => {
      const futureDate = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const farFuture = new Date(
        Date.now() + 730 * 24 * 60 * 60 * 1000,
      ).toISOString();

      getAnalyticsOverview({
        dateFrom: futureDate,
        dateTo: farFuture,
      }).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body.totalThreads).to.equal(0);
        expect(response.body.totalTokens).to.equal(0);
        expect(response.body.totalPrice).to.equal(0);
      });
    });

    it('should return 401 without auth headers', () => {
      cy.request({
        url: '/api/v1/analytics/overview',
        method: 'GET',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.equal(401);
      });
    });

    it('should isolate data between users', () => {
      const otherUserHeaders = buildAuthHeaders({
        userId: 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
      });

      getAnalyticsOverview({}, otherUserHeaders).then((response) => {
        expect(response.status).to.equal(200);
        // A different user should not see data from the main test user
        expect(response.body.totalThreads).to.equal(0);
        expect(response.body.totalTokens).to.equal(0);
      });
    });
  });

  describe('GET /v1/analytics/by-graph', () => {
    it('should return 200 with valid analytics shape', () => {
      getAnalyticsByGraph().then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.have.property('graphs');
        expect(response.body.graphs).to.be.an('array');

        if (response.body.graphs.length > 0) {
          const entry = response.body.graphs[0]!;
          expect(entry).to.have.property('graphId');
          expect(entry).to.have.property('graphName');
          expect(entry).to.have.property('totalThreads');
          expect(entry).to.have.property('totalTokens');
          expect(entry).to.have.property('totalPrice');
        }
      });
    });

    it('should accept graphId filter', () => {
      const nonExistentId = generateRandomUUID();

      getAnalyticsByGraph({ graphId: nonExistentId }).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body.graphs).to.have.length(0);
      });
    });

    it('should return 401 without auth headers', () => {
      cy.request({
        url: '/api/v1/analytics/by-graph',
        method: 'GET',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.equal(401);
      });
    });
  });

  describe('Analytics with real graph execution', () => {
    it('should reflect token usage after graph execution', () => {
      let testGraphId: string;

      const graphData = createMockGraphData({
        name: `Analytics E2E ${Math.random().toString(36).slice(0, 8)}`,
      });

      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          return waitForGraphToBeRunning(testGraphId);
        })
        .then(() => {
          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['Say hi briefly'],
          });
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);

          // Wait for thread to complete
          return waitForThreadStatus(
            triggerResponse.body.externalThreadId,
            ['done', 'need_more_info'],
            30,
            3000,
          );
        })
        .then(() => {
          // Now check analytics overview — should have at least 1 thread
          return getAnalyticsOverview();
        })
        .then((overviewResponse) => {
          expect(overviewResponse.status).to.equal(200);
          expect(overviewResponse.body.totalThreads).to.be.greaterThan(0);

          // Check by-graph filtered to our test graph
          return getAnalyticsByGraph({ graphId: testGraphId });
        })
        .then((byGraphResponse) => {
          expect(byGraphResponse.status).to.equal(200);
          expect(byGraphResponse.body.graphs).to.have.length(1);

          const entry = byGraphResponse.body.graphs[0]!;
          expect(entry.graphId).to.equal(testGraphId);
          expect(entry.totalThreads).to.equal(1);
          // After a real LLM call, tokens and price should be > 0
          expect(entry.totalTokens).to.be.greaterThan(0);
          expect(entry.inputTokens).to.be.greaterThan(0);
          expect(entry.outputTokens).to.be.greaterThan(0);

          cy.task('log', `Analytics entry: ${JSON.stringify(entry)}`);
        });
    });
  });
});
