import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Query,
} from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infra/db/database.module';
import { buildProductInsights, type VoiceJobForInsight } from './product-insights';

/**
 * 管理员只读接口：查看用户对话日志，用于模型优化。
 * 受 X-Admin-Token 请求头保护；不需要也不接受 JWT 认证。
 */
@Controller('admin')
export class AdminController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private checkToken(token: string | undefined) {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken || token !== adminToken) {
      throw new ForbiddenException('Invalid admin token');
    }
  }

  /** GET /api/v1/admin/conversations
   * 返回按"对话会话"分组的完整对话记录。
   * 同一用户在 30 分钟内的连续对话合并为一个会话。
   * Query: limit(默认30, 最大100), offset, household_id, date_from, date_to
   */
  @Get('conversations')
  async conversations(
    @Headers('x-admin-token') token: string | undefined,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Query('household_id') householdId?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    this.checkToken(token);

    const limit = Math.min(Number(limitStr) || 30, 100);
    const offset = Number(offsetStr) || 0;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (householdId) {
      params.push(householdId);
      conditions.push(`vj.household_id = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`vj.created_at >= $${params.length}::timestamptz`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`vj.created_at <= $${params.length}::timestamptz`);
    }

    const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

    // 拉取所有 voice_jobs（含 dialogue_turns），按 household + 时间排序，用于在 JS 侧分组会话
    const result = await this.pool.query<{
      id: string;
      household_id: string;
      household_name: string;
      actor_member_id: string;
      status: string;
      transcript_raw: string | null;
      error_code: string | null;
      spoken_prompt: string | null;
      turn_count: number;
      dialogue_turns: Array<{ role: string; text: string; at: string }>;
      created_at: string;
      completed_at: string | null;
    }>(
      `select
         vj.id,
         vj.household_id,
         h.name as household_name,
         vj.actor_member_id,
         vj.status,
         vj.transcript_raw,
         vj.error_code,
         vj.spoken_prompt,
         vj.turn_count,
         vj.dialogue_turns,
         vj.created_at,
         vj.completed_at
       from voice_jobs vj
       left join households h on h.id = vj.household_id
       ${where}
       order by vj.household_id, vj.created_at asc`,
      params,
    );

    // 按 household + 30分钟空闲间隔 分组成会话
    const SESSION_GAP_MS = 30 * 60 * 1000;
    type Session = {
      session_id: string;
      household_id: string;
      household_name: string;
      started_at: string;
      ended_at: string;
      job_count: number;
      total_turns: number;
      has_failure: boolean;
      has_ambiguous: boolean;
      turns: Array<{ role: string; text: string; at: string; job_status?: string }>;
    };

    const sessions: Session[] = [];
    let currentSession: Session | null = null;

    for (const job of result.rows) {
      const jobTime = new Date(job.created_at).getTime();
      const lastTime = currentSession
        ? new Date(currentSession.ended_at).getTime()
        : 0;
      const sameHousehold = currentSession?.household_id === job.household_id;
      const withinGap = jobTime - lastTime < SESSION_GAP_MS;

      if (!currentSession || !sameHousehold || !withinGap) {
        currentSession = {
          session_id: job.id,
          household_id: job.household_id,
          household_name: job.household_name,
          started_at: job.created_at,
          ended_at: job.completed_at ?? job.created_at,
          job_count: 0,
          total_turns: 0,
          has_failure: false,
          has_ambiguous: false,
          turns: [],
        };
        sessions.push(currentSession);
      }

      currentSession.ended_at = job.completed_at ?? job.created_at;
      currentSession.job_count += 1;
      currentSession.total_turns += job.turn_count;
      if (job.status === 'FAILED') currentSession.has_failure = true;
      if (job.error_code === 'AMBIGUOUS_COMMAND') currentSession.has_ambiguous = true;

      // 合并 dialogue_turns，并在每个 job 末尾标注状态（方便查看）
      const turns = Array.isArray(job.dialogue_turns) ? job.dialogue_turns : [];
      for (const turn of turns) {
        currentSession.turns.push({ ...turn });
      }
    }

    // 按时间倒序（最新会话优先），再分页
    sessions.reverse();
    const total = sessions.length;
    const paginated = sessions.slice(offset, offset + limit);

    return { total, limit, offset, sessions: paginated };
  }

  /** GET /api/v1/admin/stats
   * 汇总统计：总对话数、成功率、AMBIGUOUS比例、常见FAILED词等
   */
  @Get('stats')
  async stats(@Headers('x-admin-token') token: string | undefined) {
    this.checkToken(token);

    const [summary, statusBreakdown, topFailed, activeHouseholds] = await Promise.all([
      this.pool.query(`
        select
          count(*) as total_jobs,
          count(*) filter (where status = 'COMPLETED') as completed,
          count(*) filter (where status = 'FAILED') as failed,
          count(*) filter (where status = 'CANCELLED') as cancelled,
          count(*) filter (where error_code = 'AMBIGUOUS_COMMAND') as ambiguous,
          count(distinct household_id) as unique_households,
          count(distinct actor_member_id) as unique_users,
          round(avg(turn_count)::numeric, 2) as avg_turns
        from voice_jobs
        where created_at >= now() - interval '30 days'
      `),
      this.pool.query(`
        select status, error_code, count(*) as cnt
        from voice_jobs
        where created_at >= now() - interval '7 days'
        group by status, error_code
        order by cnt desc
        limit 20
      `),
      this.pool.query(`
        select transcript_raw, count(*) as cnt
        from voice_jobs
        where status = 'FAILED' and error_code = 'AMBIGUOUS_COMMAND'
          and created_at >= now() - interval '7 days'
        group by transcript_raw
        order by cnt desc
        limit 30
      `),
      this.pool.query(`
        select h.name as display_name, count(*) as job_count, max(vj.created_at) as last_active
        from voice_jobs vj
        join households h on h.id = vj.household_id
        where vj.created_at >= now() - interval '7 days'
        group by h.id, h.name
        order by job_count desc
        limit 20
      `),
    ]);

    return {
      period: '30 days',
      summary: summary.rows[0],
      status_breakdown: statusBreakdown.rows,
      top_ambiguous_phrases: topFailed.rows,
      active_households: activeHouseholds.rows,
    };
  }

  /**
   * GET /api/v1/admin/product-insights
   * 产品优化视角的只读复盘。先用确定性证据层生成候选建议，后续可安全地接入 LLM
   * 做摘要改写，但任何建议都必须保留证据与验收标准。
   */
  @Get('product-insights')
  async productInsights(
    @Headers('x-admin-token') token: string | undefined,
    @Query('days') daysStr?: string,
  ) {
    this.checkToken(token);
    const days = Math.min(Math.max(Number(daysStr) || 30, 1), 90);
    const result = await this.pool.query<VoiceJobForInsight>(
      `select status, error_code, transcript_raw, turn_count, dialogue_turns
       from voice_jobs
       where created_at >= now() - ($1::text || ' days')::interval
       order by created_at desc`,
      [String(days)],
    );

    return {
      generated_at: new Date().toISOString(),
      scope: { days, jobs: result.rows.length },
      method: {
        name: '对话证据分析 v1',
        description: '基于任务状态、转写与轮次生成可审计建议；不会自动改写用户数据。',
      },
      ...buildProductInsights(result.rows),
    };
  }
}
