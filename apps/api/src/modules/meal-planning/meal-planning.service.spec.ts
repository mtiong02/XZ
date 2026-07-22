import { describe, expect, it, vi } from 'vitest';
import { MealPlanningService } from './meal-planning.service';

describe('MealPlanningService.addShoppingItem', () => {
  it('reactivates a previously completed recipe item so it appears in the pending list again', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'shopping-1',
          food_id: '11111111-1111-4111-8111-111111111111',
          quantity: '2',
          unit_code: 'piece',
          status: 'PENDING',
          source: 'RECIPE',
          recipe_id: '22222222-2222-4222-8222-222222222222',
        },
      ],
    });
    const service = new MealPlanningService(
      { query } as never,
      { assertMembership: vi.fn().mockResolvedValue({ memberId: 'member-1' }) } as never,
      {} as never,
    );

    await service.addShoppingItem('33333333-3333-4333-8333-333333333333', 'user-1', {
      food_id: '11111111-1111-4111-8111-111111111111',
      quantity: '2',
      unit_code: 'piece',
      source: 'RECIPE',
      recipe_id: '22222222-2222-4222-8222-222222222222',
      idempotency_key:
        'recipe-22222222-2222-4222-8222-222222222222-11111111-1111-4111-8111-111111111111',
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain("status='PENDING'");
    expect(sql).toContain('completed_at=null');
    expect(sql).toContain('created_at=now()');
  });
});
