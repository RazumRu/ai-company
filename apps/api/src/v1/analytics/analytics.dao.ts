import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { ByGraphRawRow, TokenAggregateRawRow } from './dto/analytics.dto';

type DateRangeParams = {
  createdBy: string;
  dateFrom?: string;
  dateTo?: string;
};

type ByGraphParams = DateRangeParams & {
  graphId?: string;
};

@Injectable()
export class AnalyticsDao {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Count all threads (including those with zero messages) for the user,
   * optionally filtered by date range.
   */
  async countThreads(params: DateRangeParams): Promise<number> {
    const { where, queryParams } = this.buildThreadConditions(params);

    const sql = `
      SELECT COUNT(*)::text AS cnt
      FROM threads t
      WHERE ${where}
    `;

    const rows: { cnt: string }[] = await this.dataSource.query(
      sql,
      queryParams,
    );
    return parseInt(rows[0]!.cnt, 10);
  }

  /**
   * Aggregate token usage across all messages for the user,
   * optionally filtered by date range.
   */
  async getTokenAggregates(
    params: DateRangeParams,
  ): Promise<TokenAggregateRawRow> {
    const { where, queryParams } = this.buildMessageJoinConditions(params);

    const sql = `
      SELECT
        ${this.tokenSumSelects()}
      FROM messages m
      INNER JOIN threads t ON t.id = m."threadId"
      WHERE ${where}
    `;

    const rows: TokenAggregateRawRow[] = await this.dataSource.query(
      sql,
      queryParams,
    );
    return rows[0]!;
  }

  /**
   * Aggregate token usage grouped by graph, optionally filtered
   * by date range and/or a specific graph.
   */
  async getByGraph(params: ByGraphParams): Promise<ByGraphRawRow[]> {
    const ctx = this.createParamContext(params.createdBy);

    ctx.addCondition('t."deletedAt" IS NULL');
    ctx.addCondition('m."deletedAt" IS NULL');
    ctx.addCondition('m."requestTokenUsage" IS NOT NULL');
    if (params.dateFrom) ctx.addParam('t."createdAt" >=', params.dateFrom);
    if (params.dateTo) ctx.addParam('t."createdAt" <', params.dateTo);
    if (params.graphId) ctx.addParam('t."graphId" =', params.graphId);

    const sql = `
      SELECT
        g.id AS "graphId",
        g.name AS "graphName",
        COUNT(DISTINCT t.id)::text AS "totalThreads",
        ${this.tokenSumSelects()}
      FROM messages m
      INNER JOIN threads t ON t.id = m."threadId"
      INNER JOIN graphs g ON g.id = t."graphId"
      WHERE ${ctx.where()}
      GROUP BY g.id, g.name
      ORDER BY "totalTokens" DESC
    `;

    return this.dataSource.query(sql, ctx.params);
  }

  // ── Private helpers ──────────────────────────────────────────

  private buildThreadConditions(params: DateRangeParams) {
    const ctx = this.createParamContext(params.createdBy);
    ctx.addCondition('t."deletedAt" IS NULL');
    if (params.dateFrom) ctx.addParam('t."createdAt" >=', params.dateFrom);
    if (params.dateTo) ctx.addParam('t."createdAt" <', params.dateTo);

    return { where: ctx.where(), queryParams: ctx.params };
  }

  private buildMessageJoinConditions(params: DateRangeParams) {
    const ctx = this.createParamContext(params.createdBy);
    ctx.addCondition('t."deletedAt" IS NULL');
    ctx.addCondition('m."deletedAt" IS NULL');
    ctx.addCondition('m."requestTokenUsage" IS NOT NULL');
    if (params.dateFrom) ctx.addParam('t."createdAt" >=', params.dateFrom);
    if (params.dateTo) ctx.addParam('t."createdAt" <', params.dateTo);

    return { where: ctx.where(), queryParams: ctx.params };
  }

  private createParamContext(createdBy: string) {
    const conditions: string[] = [];
    const params: string[] = [];
    let idx = 1;

    // Always add the createdBy condition first
    conditions.push(`t."createdBy" = $${idx}`);
    params.push(createdBy);
    idx++;

    return {
      params,
      addCondition(condition: string) {
        conditions.push(condition);
      },
      addParam(expr: string, value: string) {
        conditions.push(`${expr} $${idx}`);
        params.push(value);
        idx++;
      },
      where() {
        return conditions.join(' AND ');
      },
    };
  }

  private tokenSumSelects(): string {
    return `
      COALESCE(SUM((m."requestTokenUsage"->>'inputTokens')::numeric), 0)::text     AS "inputTokens",
      COALESCE(SUM((m."requestTokenUsage"->>'cachedInputTokens')::numeric), 0)::text AS "cachedInputTokens",
      COALESCE(SUM((m."requestTokenUsage"->>'outputTokens')::numeric), 0)::text     AS "outputTokens",
      COALESCE(SUM((m."requestTokenUsage"->>'reasoningTokens')::numeric), 0)::text  AS "reasoningTokens",
      COALESCE(SUM((m."requestTokenUsage"->>'totalTokens')::numeric), 0)::text      AS "totalTokens",
      COALESCE(SUM((m."requestTokenUsage"->>'totalPrice')::numeric), 0)::text       AS "totalPrice"
    `.trim();
  }
}
