import { Controller, ForbiddenException, Get, Headers, Inject, Param, Query } from '@nestjs/common';
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
      const lastTime = currentSession ? new Date(currentSession.ended_at).getTime() : 0;
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
   * 汇总统计：总对话数、注册用户数、成功率、AMBIGUOUS比例、常见FAILED词等
   */
  @Get('stats')
  async stats(@Headers('x-admin-token') token: string | undefined) {
    this.checkToken(token);

    const [summary, regStats, statusBreakdown, topFailed, activeHouseholds] = await Promise.all([
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
        select
          (select count(*)::int from households) as total_registered_households,
          (select count(*)::int from household_members) as total_registered_members,
          (select count(*)::int from auth.users) as total_registered_users
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
        select
          h.id as household_id,
          h.name as household_name,
          coalesce(
            string_agg(distinct hm.display_name || coalesce(' (' || u.email || ')', ''), ', '),
            h.name
          ) as display_name,
          count(vj.id)::int as job_count,
          coalesce(max(vj.created_at), h.created_at) as last_active
        from households h
        left join household_members hm on hm.household_id = h.id
        left join auth.users u on u.id = hm.user_id
        left join voice_jobs vj on vj.household_id = h.id
        group by h.id, h.name, h.created_at
        order by last_active desc
        limit 50
      `),
    ]);

    const sum = {
      ...summary.rows[0],
      ...regStats.rows[0],
    };

    return {
      period: '30 days',
      summary: sum,
      status_breakdown: statusBreakdown.rows,
      top_ambiguous_phrases: topFailed.rows,
      active_households: activeHouseholds.rows,
    };
  }

  /** GET /api/v1/admin/validation-metrics
   * 验证期只读指标：打开、核心意图、餐食方案与购物清单链路。
   */
  @Get('validation-metrics')
  async validationMetrics(
    @Headers('x-admin-token') token: string | undefined,
    @Query('days') daysStr?: string,
  ) {
    this.checkToken(token);
    const days = Math.min(Math.max(Number(daysStr) || 14, 1), 90);
    const [events, households, funnel, dailyOpens, firstUtterances, failureSteps] =
      await Promise.all([
        this.pool.query(
          `select event_type, count(*)::int as event_count,
                count(distinct household_id)::int as households
           from agent_events
          where created_at >= now() - ($1::text || ' days')::interval
          group by event_type
          order by event_count desc`,
          [String(days)],
        ),
        this.pool.query(
          `select count(distinct household_id)::int as opened_households,
                count(*) filter (where event_type = 'PRODUCT_OPENED')::int as opens,
                count(distinct actor_member_id)::int as active_members
           from agent_events
          where created_at >= now() - ($1::text || ' days')::interval`,
          [String(days)],
        ),
        this.pool.query(
          `select
          count(*) filter (where event_type = 'MEAL_PLAN_GENERATED')::int as meal_plans_generated,
          count(*) filter (where event_type = 'MEAL_PLAN_ACCEPTED')::int as meal_plans_accepted,
          count(*) filter (where event_type = 'MEAL_PLAN_MODIFIED')::int as meal_plans_modified,
          count(*) filter (where event_type = 'MEAL_PLAN_REJECTED')::int as meal_plans_rejected,
          count(*) filter (where event_type = 'SHOPPING_DRAFT_CREATED')::int as shopping_drafts,
          count(*) filter (where event_type = 'SHOPPING_CONFIRMED')::int as shopping_confirmed,
          count(*) filter (where event_type = 'VOICE_FAILURE')::int as voice_failures
         from agent_events
         where created_at >= now() - ($1::text || ' days')::interval`,
          [String(days)],
        ),
        this.pool.query(
          `select to_char(created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as day,
                count(*)::int as opens,
                count(distinct household_id)::int as households
           from agent_events
          where event_type='PRODUCT_OPENED'
            and created_at >= now() - ($1::text || ' days')::interval
          group by 1 order by 1`,
          [String(days)],
        ),
        this.pool.query(
          `select metadata->>'text' as text, count(*)::int as count
           from agent_events
          where event_type='FIRST_UTTERANCE'
            and created_at >= now() - ($1::text || ' days')::interval
            and nullif(metadata->>'text','') is not null
          group by 1 order by count desc limit 20`,
          [String(days)],
        ),
        this.pool.query(
          `select coalesce(metadata->>'step','unknown') as step,
                count(*) filter (where outcome in ('failed','FAILED'))::int as failures,
                count(*)::int as events
           from agent_events
          where event_type='MEAL_FLOW_STEP'
            and created_at >= now() - ($1::text || ' days')::interval
          group by 1 order by failures desc, events desc`,
          [String(days)],
        ),
      ]);
    return {
      period_days: days,
      generated_at: new Date().toISOString(),
      households: households.rows[0],
      funnel: funnel.rows[0],
      events: events.rows,
      daily_opens: dailyOpens.rows,
      top_first_utterances: firstUtterances.rows,
      meal_flow_failure_steps: failureSteps.rows,
      definitions: {
        opens: 'PRODUCT_OPENED 次数；按上海时区按天统计',
        first_utterance: '每个会话的第一句用户原始转写',
        failure_steps: 'MEAL_FLOW_STEP 中按 step 聚合失败事件',
        meal_plan_acceptance: 'MEAL_PLAN_ACCEPTED / MEAL_PLAN_GENERATED',
        meal_plan_feedback: 'MEAL_PLAN_ACCEPTED / MODIFIED / REJECTED 来自用户明确反馈按钮',
        shopping_confirmation: 'SHOPPING_CONFIRMED / SHOPPING_DRAFT_CREATED',
      },
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

  /**
   * GET /api/v1/admin/user-analytics
   * 内测用户分析与使用时长统计
   */
  @Get('user-analytics')
  async userAnalytics(
    @Headers('x-admin-token') token: string | undefined,
    @Query('days') daysStr?: string,
  ) {
    this.checkToken(token);
    const days = Math.min(Math.max(Number(daysStr) || 30, 1), 180);

    const toIso = (val: unknown): string => {
      if (!val) return new Date().toISOString();
      if (val instanceof Date) return val.toISOString();
      if (typeof val === 'string') return val;
      if (typeof val === 'number') return new Date(val).toISOString();
      return new Date(String(val)).toISOString();
    };

    // 1. 获取全量内测家庭与成员信息（包含 Auth 邮箱/手机）
    const householdsResult = await this.pool.query<{
      household_id: string;
      household_name: string;
      created_at: string;
      member_count: number;
      members: Array<{
        id: string;
        display_name: string;
        role: string;
        user_id: string | null;
        email: string | null;
        created_at: string;
      }>;
    }>(
      `select
         h.id as household_id,
         h.name as household_name,
         h.created_at::text as created_at,
         count(distinct hm.id)::int as member_count,
         coalesce(
           json_agg(
             json_build_object(
               'id', hm.id,
               'display_name', hm.display_name,
               'role', hm.role,
               'user_id', hm.user_id,
               'email', u.email,
               'created_at', hm.created_at
             )
           ) filter (where hm.id is not null),
           '[]'::json
         ) as members
       from households h
       left join household_members hm on hm.household_id = h.id
       left join auth.users u on u.id = hm.user_id
       group by h.id, h.name, h.created_at
       order by h.created_at desc`,
    );

    // 2. 拉取指定时间段内的 voice_jobs 用于会话及时长计算
    const jobsResult = await this.pool.query<{
      id: string;
      household_id: string;
      status: string;
      turn_count: number;
      created_at: string;
      completed_at: string | null;
    }>(
      `select id, household_id, status, turn_count, created_at::text as created_at, completed_at::text as completed_at
       from voice_jobs
       where created_at >= now() - ($1::text || ' days')::interval
       order by household_id, created_at asc`,
      [String(days)],
    );

    // 3. 拉取事件统计与内测反馈统计
    const [eventsResult, feedbackResult] = await Promise.all([
      this.pool.query<{ household_id: string; cnt: number }>(
        `select household_id, count(*)::int as cnt
         from agent_events
         where created_at >= now() - ($1::text || ' days')::interval
         group by household_id`,
        [String(days)],
      ),
      this.pool.query<{ household_id: string; cnt: number }>(
        `select household_id, count(*)::int as cnt
         from beta_feedbacks
         group by household_id`,
      ),
    ]);

    const eventsMap = new Map(eventsResult.rows.map((r) => [r.household_id, r.cnt]));
    const feedbackMap = new Map(feedbackResult.rows.map((r) => [r.household_id, r.cnt]));

    // 4. 按 30 分钟空闲间隔将对话归集为会话，并计算每个家庭的时长与活跃天数
    const SESSION_GAP_MS = 30 * 60 * 1000;
    const householdStats = new Map<
      string,
      {
        total_duration_ms: number;
        session_count: number;
        total_turns: number;
        active_days: Set<string>;
        last_active: string | null;
      }
    >();

    const distribution = {
      under_1m: 0,
      m1_5: 0,
      m5_15: 0,
      m15_30: 0,
      over_30m: 0,
    };

    let currentHouseholdId: string | null = null;
    let currentSessionStart: number = 0;
    let currentSessionEnd: number = 0;
    let currentTurns = 0;

    const finalizeSession = () => {
      if (!currentHouseholdId || !currentSessionStart) return;
      const rawMs = currentSessionEnd - currentSessionStart;
      const durationMs = Math.max(60000, rawMs);
      const minutes = durationMs / 60000;

      if (minutes < 1) distribution.under_1m++;
      else if (minutes <= 5) distribution.m1_5++;
      else if (minutes <= 15) distribution.m5_15++;
      else if (minutes <= 30) distribution.m15_30++;
      else distribution.over_30m++;

      let stat = householdStats.get(currentHouseholdId);
      if (!stat) {
        stat = {
          total_duration_ms: 0,
          session_count: 0,
          total_turns: 0,
          active_days: new Set(),
          last_active: null,
        };
        householdStats.set(currentHouseholdId, stat);
      }
      stat.total_duration_ms += durationMs;
      stat.session_count += 1;
      stat.total_turns += currentTurns;
    };

    for (const job of jobsResult.rows) {
      const createdAtIso = toIso(job.created_at);
      const completedAtIso = job.completed_at ? toIso(job.completed_at) : createdAtIso;
      const jobStart = new Date(createdAtIso).getTime();
      const jobEnd = new Date(completedAtIso).getTime();
      const dateKey = createdAtIso.slice(0, 10);

      let stat = householdStats.get(job.household_id);
      if (!stat) {
        stat = {
          total_duration_ms: 0,
          session_count: 0,
          total_turns: 0,
          active_days: new Set(),
          last_active: null,
        };
        householdStats.set(job.household_id, stat);
      }
      stat.active_days.add(dateKey);
      if (!stat.last_active || createdAtIso > stat.last_active) {
        stat.last_active = createdAtIso;
      }

      if (
        currentHouseholdId !== job.household_id ||
        jobStart - currentSessionEnd > SESSION_GAP_MS
      ) {
        finalizeSession();
        currentHouseholdId = job.household_id;
        currentSessionStart = jobStart;
        currentSessionEnd = Math.max(jobStart, jobEnd);
        currentTurns = job.turn_count || 1;
      } else {
        currentSessionEnd = Math.max(currentSessionEnd, jobEnd);
        currentTurns += job.turn_count || 1;
      }
    }
    finalizeSession();

    // 5. 组合家庭与用户分析列表
    let grandTotalDurationMs = 0;
    let totalSessionsAll = 0;

    const userList = householdsResult.rows.map((h) => {
      const stat = householdStats.get(h.household_id) || {
        total_duration_ms: 0,
        session_count: 0,
        total_turns: 0,
        active_days: new Set<string>(),
        last_active: null,
      };

      grandTotalDurationMs += stat.total_duration_ms;
      totalSessionsAll += stat.session_count;

      const durationMinutes = Math.round(stat.total_duration_ms / 60000);
      const createdAtStr = toIso(h.created_at);
      const lastActiveStr = stat.last_active ? toIso(stat.last_active) : createdAtStr;

      return {
        household_id: h.household_id,
        household_name: h.household_name || '未命名用户',
        created_at: createdAtStr,
        member_count: h.member_count,
        members: Array.isArray(h.members) ? h.members : [],
        session_count: stat.session_count,
        total_turns: stat.total_turns,
        event_count: eventsMap.get(h.household_id) || 0,
        feedback_count: feedbackMap.get(h.household_id) || 0,
        total_duration_minutes: durationMinutes,
        total_duration_formatted:
          durationMinutes >= 60
            ? `${(durationMinutes / 60).toFixed(1)} 小时`
            : `${durationMinutes} 分钟`,
        active_days_count: stat.active_days.size,
        last_active: lastActiveStr,
      };
    });

    const totalDurationMinutes = Math.round(grandTotalDurationMs / 60000);
    const avgSessionMinutes =
      totalSessionsAll > 0 ? Math.round(totalDurationMinutes / totalSessionsAll) : 0;

    return {
      period_days: days,
      summary: {
        total_households: userList.length,
        total_members: userList.reduce((acc, curr) => acc + curr.member_count, 0),
        total_duration_minutes: totalDurationMinutes,
        total_duration_formatted:
          totalDurationMinutes >= 60
            ? `${(totalDurationMinutes / 60).toFixed(1)} 小时`
            : `${totalDurationMinutes} 分钟`,
        avg_session_minutes: avgSessionMinutes,
        total_sessions: totalSessionsAll,
      },
      duration_distribution: distribution,
      users: userList,
    };
  }

  /**
   * GET /api/v1/admin/households/:id/detail
   * 单个内测用户的详细画像与交互履历
   */
  @Get('households/:id/detail')
  async householdDetail(
    @Headers('x-admin-token') token: string | undefined,
    @Param('id') householdId: string,
  ) {
    this.checkToken(token);

    // 1. 家庭与成员信息
    const hhResult = await this.pool.query<{
      id: string;
      name: string;
      timezone: string;
      created_at: string;
      members: Array<{
        id: string;
        display_name: string;
        role: string;
        user_id: string | null;
        email: string | null;
        created_at: string;
      }>;
    }>(
      `select
         h.id,
         h.name,
         h.timezone,
         h.created_at,
         coalesce(
           json_agg(
             json_build_object(
               'id', hm.id,
               'display_name', hm.display_name,
               'role', hm.role,
               'user_id', hm.user_id,
               'email', u.email,
               'created_at', hm.created_at
             )
           ) filter (where hm.id is not null),
           '[]'::json
         ) as members
       from households h
       left join household_members hm on hm.household_id = h.id
       left join auth.users u on u.id = hm.user_id
       where h.id = $1
       group by h.id, h.name, h.timezone, h.created_at`,
      [householdId],
    );

    if (!hhResult.rows[0]) {
      return { success: false, message: 'Household not found' };
    }

    const household = hhResult.rows[0];

    // 2. 对话记录
    const jobsResult = await this.pool.query<{
      id: string;
      status: string;
      transcript_raw: string | null;
      error_code: string | null;
      spoken_prompt: string | null;
      turn_count: number;
      dialogue_turns: Array<{ role: string; text: string; at: string }>;
      created_at: string;
      completed_at: string | null;
    }>(
      `select id, status, transcript_raw, error_code, spoken_prompt, turn_count, dialogue_turns, created_at, completed_at
       from voice_jobs
       where household_id = $1
       order by created_at asc`,
      [householdId],
    );

    // 会话拆分
    const SESSION_GAP_MS = 30 * 60 * 1000;
    type DetailSession = {
      session_id: string;
      started_at: string;
      ended_at: string;
      duration_minutes: number;
      job_count: number;
      total_turns: number;
      turns: Array<{ role: string; text: string; at: string }>;
    };

    const sessions: DetailSession[] = [];
    let currentSession: DetailSession | null = null;
    let totalDurationMs = 0;

    for (const job of jobsResult.rows) {
      const jobTime = new Date(job.created_at).getTime();
      const lastTime = currentSession ? new Date(currentSession.ended_at).getTime() : 0;

      if (!currentSession || jobTime - lastTime >= SESSION_GAP_MS) {
        if (currentSession) {
          const rawMs =
            new Date(currentSession.ended_at).getTime() -
            new Date(currentSession.started_at).getTime();
          const durationMs = Math.max(60000, rawMs);
          currentSession.duration_minutes = Math.round(durationMs / 60000);
          totalDurationMs += durationMs;
        }

        currentSession = {
          session_id: job.id,
          started_at: job.created_at,
          ended_at: job.completed_at ?? job.created_at,
          duration_minutes: 1,
          job_count: 0,
          total_turns: 0,
          turns: [],
        };
        sessions.push(currentSession);
      }

      currentSession.ended_at = job.completed_at ?? job.created_at;
      currentSession.job_count += 1;
      currentSession.total_turns += job.turn_count || 1;

      const turns = Array.isArray(job.dialogue_turns) ? job.dialogue_turns : [];
      for (const turn of turns) {
        currentSession.turns.push({ ...turn });
      }
    }

    if (currentSession) {
      const rawMs =
        new Date(currentSession.ended_at).getTime() - new Date(currentSession.started_at).getTime();
      const durationMs = Math.max(60000, rawMs);
      currentSession.duration_minutes = Math.round(durationMs / 60000);
      totalDurationMs += durationMs;
    }

    sessions.reverse();

    // 3. 用户提交的反馈
    const feedbackResult = await this.pool.query(
      `select id, category, content, rating, contact, status, created_at
       from beta_feedbacks
       where household_id = $1
       order by created_at desc`,
      [householdId],
    );

    // 4. 事件类型分布
    const eventsResult = await this.pool.query<{ event_type: string; count: number }>(
      `select event_type, count(*)::int as count
       from agent_events
       where household_id = $1
       group by event_type
       order by count desc`,
      [householdId],
    );

    const totalDurationMinutes = Math.round(totalDurationMs / 60000);

    return {
      household,
      summary: {
        total_sessions: sessions.length,
        total_jobs: jobsResult.rows.length,
        total_duration_minutes: totalDurationMinutes,
        total_duration_formatted:
          totalDurationMinutes >= 60
            ? `${(totalDurationMinutes / 60).toFixed(1)} 小时`
            : `${totalDurationMinutes} 分钟`,
        feedbacks_count: feedbackResult.rows.length,
      },
      feature_usage: eventsResult.rows,
      feedbacks: feedbackResult.rows,
      sessions,
    };
  }
}
