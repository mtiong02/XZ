import { describe, expect, it, vi, beforeEach } from 'vitest';
import { VoiceService } from './voice.service';
import type { FoodCatalogEntry } from './parser/intent-parser';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../inventory/domain/errors';

/**
 * 场景演化压力测试 (多场景集成测试)
 */
describe('Voice Engine - Multi-turn Scenarios', () => {
  let jobsDb: Map<string, Record<string, unknown>>;
  let executeCommandMock: ReturnType<typeof vi.fn>;
  let service: VoiceService;

  const catalog: FoodCatalogEntry[] = [
    {
      id: 'apple',
      canonicalName: '苹果',
      defaultUnitCode: 'piece',
      aliases: [],
      category: 'FRUIT',
    },
    { id: 'milk', canonicalName: '牛奶', defaultUnitCode: 'box', aliases: [] },
    {
      id: 'egg',
      canonicalName: '鸡蛋',
      defaultUnitCode: 'piece',
      aliases: [],
      category: 'VEGETABLE',
    },
    {
      id: 'banana',
      canonicalName: '香蕉',
      defaultUnitCode: 'piece',
      aliases: [],
      category: 'FRUIT',
    },
    { id: 'pear', canonicalName: '梨', defaultUnitCode: 'piece', aliases: [], category: 'FRUIT' },
  ];

  beforeEach(() => {
    jobsDb = new Map();
    executeCommandMock = vi.fn().mockResolvedValue({ transaction_id: 'txn-1' });

    const queryMock = vi.fn(async (sql: string, params?: unknown[]) => {
      // Mock catalog
      if (sql.includes('from food_catalog fc')) {
        return {
          rows: catalog.map((c) => ({
            id: c.id,
            canonical_name: c.canonicalName,
            aliases: c.aliases,
            default_unit_code: c.defaultUnitCode,
            category: c.category,
          })),
        };
      }

      // Voice jobs pending read
      if (
        sql.includes('select id, candidate_command_json') &&
        sql.includes('where household_id = $1 and session_id = $2')
      ) {
        const householdId = params?.[0];
        const sessionId = params?.[1];
        const pending = Array.from(jobsDb.values()).find(
          (j) =>
            j.household_id === householdId &&
            j.session_id === sessionId &&
            (j.status === 'AWAITING_CLARIFICATION' || j.status === 'AWAITING_CONFIRMATION'),
        );
        return { rows: pending ? [pending] : [] };
      }

      // Voice job by ID
      if (sql.includes('from voice_jobs where id = $1')) {
        const job = jobsDb.get(params?.[0] as string);
        return { rows: job ? [job] : [] };
      }

      // Update
      if (sql.includes('update voice_jobs')) {
        const id = params?.[0] as string;
        const job = jobsDb.get(id);
        if (job) {
          if (sql.includes('set status = $2')) {
            job.status = params?.[1];
            job.candidate_command_json = params?.[2] ? JSON.parse(params[2] as string) : null;
            job.spoken_prompt = params?.[3];
          } else if (sql.includes("status = 'COMPLETED'")) {
            job.status = 'COMPLETED';
            job.spoken_prompt = params?.[2];
          } else if (sql.includes("status = 'CANCELLED'")) {
            job.status = 'CANCELLED';
            job.spoken_prompt = params?.[1];
          } else if (sql.includes("status='FAILED'")) {
            job.status = 'FAILED';
            job.spoken_prompt = params?.[1];
          }
        }
        return { rows: [] };
      }

      if (sql.includes('insert into voice_jobs')) {
        const job: Record<string, unknown> = {
          id: params?.[0],
          household_id: params?.[1],
          actor_member_id: params?.[2],
          status: params?.[3],
          locale: params?.[4],
          source_channel: params?.[5],
          transcript_raw: params?.[6],
          transcript_normalized: params?.[7],
          candidate_command_json: params?.[8] ? JSON.parse(params[8] as string) : null,
          confidence_json: params?.[9] ? JSON.parse(params[9] as string) : {},
          requires_confirmation: params?.[10],
          error_code: params?.[11],
          client_request_id: params?.[12],
          spoken_prompt: params?.[13],
          dialogue_turns: params?.[14] ? JSON.parse(params[14] as string) : [],
          session_id: params?.[15],
          turn_id: params?.[16],
          turn_count: 1,
          created_at: new Date(),
          completed_at: null,
          executed_transaction_id: null,
        };
        jobsDb.set(job.id as string, job);
        return { rows: [{ id: job.id }] };
      }

      return { rows: [] };
    });

    service = new VoiceService(
      { query: queryMock } as never,
      { assertMembership: vi.fn().mockResolvedValue({ memberId: 'member-1' }) } as never,
      { execute: executeCommandMock } as never,
      {
        getInventoryView: vi.fn().mockResolvedValue({
          zones: [{ items: [{ food_id: 'apple', total_quantity: '5', unit: 'piece' }] }],
        }),
      } as never, // queries
      { resolveSpokenQuery: vi.fn().mockResolvedValue(null) } as never, // foodCategories
      {} as never, // notifications
      {
        getMealContextClarification: vi.fn().mockResolvedValue(null),
        findSuggestedRecipeForVoiceRequest: vi.fn().mockResolvedValue(null),
      } as never, // meals
      { begin: vi.fn(), getActive: vi.fn(), complete: vi.fn(), cancel: vi.fn() } as never, // coordinator
      { recordEvent: vi.fn() } as never, // telemetry
      { execute: vi.fn().mockResolvedValue({ zones: [] }) } as never, // toolExecutor
    );
  });

  const householdId = 'hh-1';
  const userId = 'u-1';
  let sessionId: string;

  beforeEach(() => {
    sessionId = randomUUID();
  });

  it('Scenario 1: 碎片化槽位填充 (Fragmented Slot Filling)', async () => {
    // 1. 用户说: "添加食材"
    let res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '添加食材',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');
    expect(res.spoken_prompt).toContain('已开启连续记录');

    // 2. 用户说: "苹果"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '苹果',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');
    expect(res.spoken_prompt).toContain('已记下：苹果1个（共1样）。继续报或说“就这些”。');
    expect(res.candidate_command?.payload?.items?.[0]?.food_id).toBe('apple');

    // 3. 用户说: "三个"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '三个',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CONFIRMATION');
    expect(res.candidate_command?.payload?.items?.[0]?.quantity).toBe('3');

    // 4. 用户说: "对"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '对',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('COMPLETED');
    expect(executeCommandMock).toHaveBeenCalled();
  });

  it('Scenario 2: 领域异常拦截与细分恢复 (Domain Error Recovery)', async () => {
    // Mock 抛出库存不足错误
    executeCommandMock.mockRejectedValueOnce(
      new DomainError('CONFLICT', 'INVENTORY_INSUFFICIENT', '库存不足', {
        available: '1',
        unit: 'piece',
      }),
    );

    // 1. 用户说: "用掉三个苹果"
    let res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '用掉三个苹果',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CONFIRMATION');

    // 2. 用户说: "是的" -> 尝试执行 -> 报错
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '是的',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');
    expect(res.spoken_prompt).toContain('库存不足');
    expect(res.spoken_prompt).toContain('是要全部用掉吗');

    // 3. 用户说: "全部用掉"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '全部用掉',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CONFIRMATION');
    expect(res.candidate_command?.payload?.items?.[0]?.quantity).toBe('5'); // 从库存解析

    // 4. 用户说: "对" -> 执行成功
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '对',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('COMPLETED');
  });

  it('Scenario 3: 意图切换与强行打断 (Context Switching)', async () => {
    // 1. 用户说: "吃掉鸡蛋"
    let res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '吃掉鸡蛋',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');

    // 2. 用户说: "算了，查询库存" (切换意图，触发 REJECT)
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '算了，查询库存',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('CANCELLED');
  });

  it('Scenario 4: 歧义输入追问 (Ambiguous Command Clarification)', async () => {
    // 1. 用户说: "牛奶"
    let res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '牛奶',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');
    expect(res.spoken_prompt).toContain('我听到了牛奶');
    expect(res.spoken_prompt).toContain('添加、用掉还是查询库存');

    // 2. 用户说: "用掉两盒"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '全用掉',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CONFIRMATION');
    expect(res.candidate_command?.command_type).toBe('CONSUME_INVENTORY');
  });

  it('Scenario 5: 复杂多实体连续补充 (Multi-entity continuous filling)', async () => {
    // 1. 用户说: "帮我记一下"
    let res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '添加食材',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');

    // 2. 用户说: "买了点香蕉"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '买了点香蕉',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');
    expect(res.candidate_command?.payload?.items).toHaveLength(1);
    expect(res.candidate_command?.payload?.items?.[0]?.food_id).toBe('banana');

    // 3. 用户说: "还有三个苹果"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '还有三个苹果',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');
    expect(res.candidate_command?.payload?.items).toHaveLength(2);

    // 4. 用户说: "不是香蕉，是五个梨"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '不是香蕉，是五个梨',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION'); // Still clarifying because it expects "就这些"
    expect(res.candidate_command?.payload?.items).toHaveLength(2);
    expect(
      res.candidate_command?.payload?.items?.map((i: { food_id: string }) => i.food_id).sort(),
    ).toEqual(['apple', 'pear']);

    // 5. 用户说: "就这些"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '就这些',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CONFIRMATION');

    // 6. 用户说: "对"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '对',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('COMPLETED');
  });

  it('Scenario 6: 连续重量单位转换为离散数量追问 (Weight to Count Clarification)', async () => {
    // 1. 用户说: "买了两斤苹果"
    let res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '买了两斤苹果',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');
    expect(res.spoken_prompt).toContain('大概包含几个呢？记录个数会更方便以后吃的时候直接扣减哦。');
    expect(res.candidate_command?.payload?.items?.[0]?.quantity).toBe('2');
    expect(res.candidate_command?.payload?.items?.[0]?.unit).toBe('jin');

    // 2. 用户说: "六个"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '六个',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CONFIRMATION');
    expect(res.candidate_command?.payload?.items?.[0]?.quantity).toBe('6');
    expect(res.candidate_command?.payload?.items?.[0]?.unit).toBe('piece');
    expect(res.spoken_prompt).toContain('确认添加6个苹果');

    // 3. 用户说: "是的"
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '是的',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('COMPLETED');
  });

  it('Scenario 7: 智能跳过补充追问 (Skip Optional Clarification)', async () => {
    let res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '买了两斤苹果',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');
    expect(res.spoken_prompt).toContain('大概包含几个呢');

    // 用户回答不知道
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '不知道',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CONFIRMATION');
    // 依然保持两斤
    expect(res.candidate_command?.payload?.items?.[0]?.quantity).toBe('2');
    expect(res.candidate_command?.payload?.items?.[0]?.unit).toBe('jin');
  });

  it('Scenario 8: 离散数量转换为连续重量追问并保护原始单位 (Count to Weight Clarification)', async () => {
    let res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '买了6个苹果',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');
    expect(res.spoken_prompt).toContain('大概有多重呢');

    // 用户回答两斤
    res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '两斤',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CONFIRMATION');
    // 口播需要体现追加的信息
    expect(res.spoken_prompt).toContain('约重2斤');
    expect(res.spoken_prompt).toContain('添加6个苹果');
  });

  it('Scenario 9: ASR 错别字与模糊同音字预修复 (ASR Typo Auto-Fix)', async () => {
    const res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '添加两百克机胸肉',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CONFIRMATION');
    expect(res.candidate_command?.payload?.items?.[0]?.display_text).toBe('鸡胸肉');
    expect(res.candidate_command?.payload?.items?.[0]?.quantity).toBe('200');
    expect(res.candidate_command?.payload?.items?.[0]?.unit).toBe('g');
  });

  it('Scenario 10: 方言量词与大数自动映射 (Dialect Measure Words)', async () => {
    const res = await service.createTextJob(userId, {
      household_id: householdId,
      session_id: sessionId,
      transcript_text: '买了一打鸡蛋',
      channel: 'WEB_VOICE',
      locale: 'zh-CN',
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe('AWAITING_CLARIFICATION');
    expect(res.candidate_command?.payload?.items?.[0]?.display_text).toBe('鸡蛋');
    expect(res.candidate_command?.payload?.items?.[0]?.quantity).toBe('12');
    expect(res.candidate_command?.payload?.items?.[0]?.unit).toBe('piece');
  });
});
