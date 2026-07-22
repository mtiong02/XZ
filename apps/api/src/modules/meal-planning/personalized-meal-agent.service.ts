import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../../infra/db/database.module';
import type { FamilyMealContext } from '../agent-runtime/agent-runtime.types';

const AgentResponseSchema = z.object({
  answer: z.string().min(1).max(700),
  selected_dishes: z.array(z.string().min(1).max(60)).max(6).default([]),
  uses_inventory: z.array(z.string().min(1).max(60)).max(20).default([]),
  missing: z.array(z.string().min(1).max(60)).max(20).default([]),
  personalization_basis: z.array(z.string().min(1).max(80)).max(6).default([]),
});

export interface MealAgentContext {
  householdId: string;
  memberId: string;
  requestText: string;
  inventory: Array<{
    name: string;
    quantity?: string;
    unit?: string;
    expiryStatus?: string;
  }>;
  recipes: Array<{
    name: string;
    description: string;
    servings: number;
    canMake: boolean;
    coverage: number;
    ingredients: string[];
    missing: string[];
    expiringIngredientCount: number;
  }>;
  householdMemberCount: number;
  familyContext?: FamilyMealContext | undefined;
  temporaryContext?:
    | {
        occasion: string;
        dateReference: string;
        diningMode: string;
        dinerCount: number | null;
      }
    | undefined;
  fallbackAnswer: string;
  signal?: AbortSignal | undefined;
}

interface ProfileRow {
  member_id: string;
  display_name: string;
  goal: string;
  activity_level: string;
  allergen_codes: string[];
  dietary_restrictions: string[];
  health_considerations: string[];
}

interface RecentMealRow {
  transcript_normalized: string | null;
  spoken_prompt: string | null;
}

interface MiniMaxChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const MEAL_HISTORY_PATTERN =
  '(早餐|午餐|晚餐|下午茶|加餐|夜宵|食谱|菜谱|推荐|减脂|减肥|聚会|几个人|少油|少盐)';

/**
 * 小知个性化餐食 Agent。
 * 只在 MealPlanningService 明确判定为餐食决策时调用；它不拥有任何写库存能力。
 */
@Injectable()
export class PersonalizedMealAgentService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async recommend(context: MealAgentContext): Promise<string> {
    const apiKey = process.env.MINIMAX_API_KEY?.trim();
    if (!apiKey) return context.fallbackAnswer;

    const [profileResult, recentResult] = await Promise.all([
      this.pool.query<ProfileRow>(
        `select p.member_id, hm.display_name, p.goal, p.activity_level, p.allergen_codes,
                p.dietary_restrictions, p.health_considerations
         from member_wellness_profiles p
         join household_members hm on hm.id=p.member_id
         where p.household_id=$1 and (p.member_id=$2 or p.share_with_household)
         order by case when p.member_id=$2 then 0 else 1 end`,
        [context.householdId, context.memberId],
      ),
      this.pool.query<RecentMealRow>(
        `select transcript_normalized, spoken_prompt
         from voice_jobs
         where household_id=$1 and actor_member_id=$2
           and transcript_normalized ~ $3
         order by created_at desc limit 8`,
        [context.householdId, context.memberId, MEAL_HISTORY_PATTERN],
      ),
    ]);
    if (context.signal?.aborted) throw new Error('AGENT_TASK_CANCELLED');

    const profile = profileResult.rows.find((row) => row.member_id === context.memberId) ?? null;
    const sharedFamilyProfiles = profileResult.rows
      .filter((row) => row.member_id !== context.memberId)
      .map((row) => ({
        display_name: row.display_name,
        goal: row.goal,
        allergen_codes: row.allergen_codes,
        dietary_restrictions: row.dietary_restrictions,
        health_considerations: row.health_considerations,
      }));
    const availableNames = new Set(context.inventory.map((item) => item.name));
    const payload = {
      current_request: context.requestText,
      household: {
        member_count: context.householdMemberCount,
        family_model: context.familyContext ?? null,
        temporary_context: context.temporaryContext ?? null,
      },
      current_member: profile
        ? {
            goal: profile.goal,
            activity_level: profile.activity_level,
            allergen_codes: profile.allergen_codes,
            dietary_restrictions: profile.dietary_restrictions,
            health_considerations: profile.health_considerations,
          }
        : null,
      shared_family_profiles: sharedFamilyProfiles,
      inventory: context.inventory,
      reviewed_recipe_candidates: context.recipes,
      recent_meal_dialogue: recentResult.rows.map((row) => ({
        request: row.transcript_normalized,
        recommendation: row.spoken_prompt,
      })),
    };

    const startedAt = Date.now();
    const timeoutMs = Math.max(
      1_500,
      Math.min(10_000, Number(process.env.MINIMAX_AGENT_TIMEOUT_MS ?? 5_500)),
    );
    try {
      // 与实时语音使用同一套 MiniMax 账户；当前部署密钥属于 minimax.chat 兼容接口。
      const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        signal: context.signal
          ? AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: process.env.MINIMAX_AGENT_MODEL?.trim() || 'abab6.5s-chat',
          messages: [
            {
              role: 'system',
              content:
                '你是鲜知的小知家庭餐食决策Agent。你只做餐食分析与推荐，不写库存。必须以给定库存为事实；结合用餐场景、当前任务人数、家庭成员限制、在家模式、家庭偏好、临期食材和最近推荐，做一次决策。当前请求里明确说的“我一个人吃/两个人/五个人/朋友聚会”等临时上下文优先于家庭默认人数，家庭模型不得覆盖当前任务。一次请求只能输出一个最终菜单方案，不能同时给多个互相冲突的方案，也不要把澄清问题伪装成菜单。人数达到4人时必须明确按人数扩充份量，必要时给出2到4道菜，而不是只给一份2人菜。只能把上下文中存在的食材写进现有菜单和执行步骤；橄榄油、香草、胡椒、柠檬等调味料如果不在库存，必须列入missing，不得假装家里已有。可以列出缺少食材，但必须与现有食材分开。过敏原与明确限制优先级最高。不要输出诊断、疗效承诺或极端节食。回答适合语音播报，但用户要求具体菜单时要包含菜名、人数/份量和简短执行顺序。只输出JSON，不要Markdown，也不要透露内部推理。JSON字段固定为answer、selected_dishes、uses_inventory、missing、personalization_basis。',
            },
            {
              role: 'user',
              content: `请根据以下经过本地工具核验的上下文做一次餐食决策：\n${JSON.stringify(payload)}`,
            },
          ],
          temperature: 0.55,
          max_tokens: 550,
        }),
      });
      const elapsedMs = Date.now() - startedAt;
      if (!response.ok) {
        console.warn(
          JSON.stringify({
            msg: 'meal_agent.failed',
            status: response.status,
            elapsed_ms: elapsedMs,
          }),
        );
        return context.fallbackAnswer;
      }
      const body = (await response.json()) as MiniMaxChatResponse;
      const content = body.choices?.[0]?.message?.content?.trim() ?? '';
      const parsed = parseAgentJson(content);
      if (!parsed) {
        console.warn(JSON.stringify({ msg: 'meal_agent.invalid_output', elapsed_ms: elapsedMs }));
        return context.fallbackAnswer;
      }
      if (parsed.uses_inventory.some((name) => !availableNames.has(name))) {
        console.warn(
          JSON.stringify({ msg: 'meal_agent.inventory_guard_failed', elapsed_ms: elapsedMs }),
        );
        return context.fallbackAnswer;
      }
      console.info(
        JSON.stringify({
          msg: 'meal_agent.completed',
          elapsed_ms: elapsedMs,
          selected_dish_count: parsed.selected_dishes.length,
          used_inventory_count: parsed.uses_inventory.length,
          missing_count: parsed.missing.length,
        }),
      );
      return /不会自动扣减|不会扣减库存/.test(parsed.answer)
        ? parsed.answer
        : `${parsed.answer} 这是建议，不会自动扣减库存。`;
    } catch (error) {
      console.warn(
        JSON.stringify({
          msg: 'meal_agent.unavailable',
          elapsed_ms: Date.now() - startedAt,
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      return context.fallbackAnswer;
    }
  }
}

function parseAgentJson(content: string): z.infer<typeof AgentResponseSchema> | null {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return AgentResponseSchema.parse(JSON.parse(content.slice(start, end + 1)));
  } catch {
    return null;
  }
}

export const __test = { parseAgentJson };
