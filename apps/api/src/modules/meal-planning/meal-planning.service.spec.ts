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
      { recommend: vi.fn() } as never,
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

describe('MealPlanningService.getMealContextClarification', () => {
  it('asks for the missing people and preference context instead of guessing', async () => {
    const service = new MealPlanningService(
      {} as never,
      { assertMembership: vi.fn().mockResolvedValue({ memberId: 'member-1' }) } as never,
      {} as never,
      {} as never,
      undefined,
      {
        build: vi.fn().mockResolvedValue({ defaultDiners: 4 }),
      } as never,
    );
    await expect(
      service.getMealContextClarification(
        '33333333-3333-4333-8333-333333333333',
        'user-1',
        '今天吃什么',
      ),
    ).resolves.toContain('今天几个人吃');
    await expect(
      service.getMealContextClarification(
        '33333333-3333-4333-8333-333333333333',
        'user-1',
        '今天四个人吃',
      ),
    ).resolves.toContain('想清淡、少油，还是有忌口');
  });

  it('keeps solo context and only asks for the missing preference', async () => {
    const familyContext = { build: vi.fn() };
    const service = new MealPlanningService(
      {} as never,
      { assertMembership: vi.fn() } as never,
      {} as never,
      {} as never,
      undefined,
      familyContext as never,
    );
    await expect(
      service.getMealContextClarification(
        '33333333-3333-4333-8333-333333333333',
        'user-1',
        '今天我一个人吃',
      ),
    ).resolves.toContain('想清淡、少油，还是有忌口');
    expect(familyContext.build).not.toHaveBeenCalled();
  });

  it('does not ask when both people and preference are explicit', async () => {
    const service = new MealPlanningService({} as never, {} as never, {} as never, {} as never);
    await expect(
      service.getMealContextClarification(
        '33333333-3333-4333-8333-333333333333',
        'user-1',
        '今天两个人吃清淡一点',
      ),
    ).resolves.toBeNull();
  });
});

describe('MealPlanningService.markShoppingItemPurchased', () => {
  it('adds the purchased quantity through the inventory command and then completes the item', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'shopping-1',
            food_id: '11111111-1111-4111-8111-111111111111',
            food_name: '土豆',
            quantity: '2',
            unit_code: 'piece',
            status: 'PENDING',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'shopping-1', status: 'PURCHASED', completed_at: '2026-07-23T00:00:00.000Z' }],
      });
    const execute = vi.fn().mockResolvedValue({
      transaction_id: 'txn-1',
      idempotent_replay: false,
    });
    const service = new MealPlanningService(
      { query } as never,
      { assertMembership: vi.fn().mockResolvedValue({ memberId: 'member-1' }) } as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      { execute } as never,
    );

    await expect(
      service.markShoppingItemPurchased(
        '33333333-3333-4333-8333-333333333333',
        'shopping-1',
        'user-1',
      ),
    ).resolves.toMatchObject({
      shopping_item_id: 'shopping-1',
      status: 'PURCHASED',
      inventory_transaction_id: 'txn-1',
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command_type: 'ADD_INVENTORY',
        idempotency_key: 'shopping-purchase-shopping-1',
        source: expect.objectContaining({ channel: 'WEB_MANUAL' }),
        payload: {
          items: [
            {
              food_id: '11111111-1111-4111-8111-111111111111',
              quantity: '2',
              unit: 'piece',
            },
          ],
        },
      }),
      'user-1',
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not mark a quantity-less shopping item as purchased', async () => {
    const execute = vi.fn();
    const service = new MealPlanningService(
      {
        query: vi.fn().mockResolvedValue({
          rows: [
            {
              id: 'shopping-2',
              food_id: '11111111-1111-4111-8111-111111111111',
              food_name: '生菜',
              quantity: null,
              unit_code: null,
              status: 'PENDING',
            },
          ],
        }),
      } as never,
      { assertMembership: vi.fn().mockResolvedValue({ memberId: 'member-1' }) } as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      { execute } as never,
    );

    await expect(
      service.markShoppingItemPurchased(
        '33333333-3333-4333-8333-333333333333',
        'shopping-2',
        'user-1',
      ),
    ).rejects.toMatchObject({ code: 'SHOPPING_QUANTITY_UNIT_REQUIRED' });
    expect(execute).not.toHaveBeenCalled();
  });
});
