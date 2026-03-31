import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type { ByGraphRawRow, TokenAggregateRawRow } from './dto/analytics.dto';

type DateRangeParams = {
  createdBy: string;
  projectId: string;
  dateFrom?: string;
  dateTo?: string;
};

type ByGraphParams = DateRangeParams & {
  graphId?: string;
};

/**
 * Raw SQL is justified here because:
 * 1. JSONB ->> path extraction has no MikroORM QueryBuilder equivalent
 * 2. Cross-entity joins (messages → threads → graphs) use FK columns
 *    without defined MikroORM relations, so QB join() can't resolve them
 */
@Injectable()
export class AnalyticsDao {
  constructor(private readonly em: EntityManager) {}

  async countThreads(params: DateRangeParams): Promise<number> {
    const ctx = this.buildBaseContext(params);
    ctx.addCondition('t.deleted_at IS NULL');
    ctx.addCondition('g.deleted_at IS NULL');
    this.applyDateRange(ctx, params);

    const rows = await this.em.getConnection().execute<{ cnt: string }[]>(
      `SELECT count(*)::text AS cnt
       FROM threads t
       INNER JOIN graphs g ON g.id = t.graph_id
       WHERE ${ctx.where()}`,
      ctx.params,
    );
    return parseInt(rows[0]!.cnt, 10);
  }

  async getTokenAggregates(
    params: DateRangeParams,
  ): Promise<TokenAggregateRawRow> {
    const ctx = this.buildBaseContext(params);
    ctx.addCondition('t.deleted_at IS NULL');
    ctx.addCondition('m.deleted_at IS NULL');
    ctx.addCondition('g.deleted_at IS NULL');
    ctx.addCondition('m.request_token_usage IS NOT NULL');
    this.applyDateRange(ctx, params);

    const rows = await this.em.getConnection().execute<TokenAggregateRawRow[]>(
      `SELECT ${this.tokenSumSelects()}
       FROM messages m
       INNER JOIN threads t ON t.id = m.thread_id
       INNER JOIN graphs g ON g.id = t.graph_id
       WHERE ${ctx.where()}`,
      ctx.params,
    );
    return rows[0]!;
  }

  async getByGraph(params: ByGraphParams): Promise<ByGraphRawRow[]> {
    const ctx = this.buildBaseContext(params);
    ctx.addCondition('t.deleted_at IS NULL');
    ctx.addCondition('m.deleted_at IS NULL');
    ctx.addCondition('g.deleted_at IS NULL');
    ctx.addCondition('m.request_token_usage IS NOT NULL');
    this.applyDateRange(ctx, params);

    if (params.graphId) {
      ctx.addParam('t.graph_id =', params.graphId);
    }

    return await this.em.getConnection().execute<ByGraphRawRow[]>(
      `SELECT g.id AS "graphId", g.name AS "graphName",
              count(DISTINCT t.id)::text AS "totalThreads",
              ${this.tokenSumSelects()}
       FROM messages m
       INNER JOIN threads t ON t.id = m.thread_id
       INNER JOIN graphs g ON g.id = t.graph_id
       WHERE ${ctx.where()}
       GROUP BY g.id, g.name
       ORDER BY "totalTokens" DESC`,
      ctx.params,
    );
  }

  private buildBaseContext(params: DateRangeParams) {
    const conditions: string[] = [];
    const paramValues: string[] = [];

    conditions.push('t.created_by = ?');
    paramValues.push(params.createdBy);

    conditions.push('g.project_id = ?');
    paramValues.push(params.projectId);

    return {
      params: paramValues,
      addCondition(condition: string) {
        conditions.push(condition);
      },
      addParam(expr: string, value: string) {
        conditions.push(`${expr} ?`);
        paramValues.push(value);
      },
      where() {
        return conditions.join(' AND ');
      },
    };
  }

  private applyDateRange(
    ctx: ReturnType<AnalyticsDao['buildBaseContext']>,
    params: DateRangeParams,
  ): void {
    if (params.dateFrom) {
      ctx.addParam('t.created_at >=', params.dateFrom);
    }
    if (params.dateTo) {
      ctx.addParam('t.created_at <', params.dateTo);
    }
  }

  private tokenSumSelects(): string {
    return [
      `COALESCE(SUM((m.request_token_usage->>'inputTokens')::numeric), 0)::text AS "inputTokens"`,
      `COALESCE(SUM((m.request_token_usage->>'cachedInputTokens')::numeric), 0)::text AS "cachedInputTokens"`,
      `COALESCE(SUM((m.request_token_usage->>'outputTokens')::numeric), 0)::text AS "outputTokens"`,
      `COALESCE(SUM((m.request_token_usage->>'reasoningTokens')::numeric), 0)::text AS "reasoningTokens"`,
      `COALESCE(SUM((m.request_token_usage->>'totalTokens')::numeric), 0)::text AS "totalTokens"`,
      `COALESCE(SUM((m.request_token_usage->>'totalPrice')::numeric), 0)::text AS "totalPrice"`,
    ].join(', ');
  }
}
