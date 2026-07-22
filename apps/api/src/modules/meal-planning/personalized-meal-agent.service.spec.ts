import { afterEach, describe, expect, it, vi } from 'vitest';
import { __test, PersonalizedMealAgentService } from './personalized-meal-agent.service';

describe('PersonalizedMealAgentService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('parses structured output even when the provider includes reasoning text', () => {
    expect(
      __test.parseAgentJson(
        '<think>internal</think>{"answer":"苹果酸奶杯","selected_dishes":["苹果酸奶杯"],"uses_inventory":["苹果","酸奶"],"missing":[],"personalization_basis":["减脂"]}',
      ),
    ).toMatchObject({ answer: '苹果酸奶杯', uses_inventory: ['苹果', '酸奶'] });
  });

  it('uses the deterministic fallback without an API key', async () => {
    vi.stubEnv('MINIMAX_API_KEY', '');
    const service = new PersonalizedMealAgentService({ query: vi.fn() } as never);
    await expect(service.recommend(context())).resolves.toBe('本地安全答案');
  });

  it('rejects a recommendation that claims unavailable inventory', async () => {
    vi.stubEnv('MINIMAX_API_KEY', 'test-key');
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  '{"answer":"做三文鱼沙拉","selected_dishes":["三文鱼沙拉"],"uses_inventory":["三文鱼"],"missing":[],"personalization_basis":[]}',
              },
            },
          ],
        }),
      }),
    );
    const service = new PersonalizedMealAgentService({ query } as never);
    await expect(service.recommend(context())).resolves.toBe('本地安全答案');
  });
});

function context() {
  return {
    householdId: 'household-1',
    memberId: 'member-1',
    requestText: '推荐一份减脂下午茶',
    inventory: [{ name: '苹果', quantity: '3', unit: 'piece' }],
    recipes: [],
    householdMemberCount: 2,
    fallbackAnswer: '本地安全答案',
  };
}
