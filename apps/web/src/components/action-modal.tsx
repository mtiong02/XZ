'use client';

import { useEffect, useMemo, useState } from 'react';
import type { InventoryView } from '@xz/contracts';
import {
  apiGet,
  executeCommand,
  type CommandType,
  type FoodCategorySummary,
  type FoodSummary,
  type UnitSummary,
} from '../lib/api';
import { unitLabel } from '../lib/format';

export type ActionKind = 'ADD' | 'CONSUME' | 'DISCARD' | 'CORRECT';

const TITLES: Record<ActionKind, string> = {
  ADD: '添加食材',
  CONSUME: '使用食材',
  DISCARD: '丢弃食材',
  CORRECT: '修正库存',
};

const COMMAND_TYPES: Record<ActionKind, CommandType> = {
  ADD: 'ADD_INVENTORY',
  CONSUME: 'CONSUME_INVENTORY',
  DISCARD: 'DISCARD_INVENTORY',
  CORRECT: 'CORRECT_INVENTORY',
};

const QUICK_EXPIRY_DAYS = [2, 3, 5, 7, 10, 14];

/**
 * 面向家庭采购的入口，采用《中国居民膳食指南》常用的食物大类；
 * 仅用于展示和筛选，数据库仍以完整分类树为唯一事实来源。
 */
const FOOD_ENTRY_GROUPS: Array<{
  label: string;
  codes: string[];
  keywords: string[];
}> = [
  {
    label: '蔬菜',
    codes: ['VEGETABLE'],
    keywords: ['菜', '瓜', '笋', '藕', '韭', '萝卜', '薯', '山药', '葱', '椒', '蒜', '香菜', '茄子', '土豆'],
  },
  {
    label: '水果',
    codes: ['FRUIT'],
    keywords: ['苹果', '蕉', '桃', '葡萄', '芒果', '梨', '瓜', '莓', '柠檬', '柚', '橘', '橙', '柿', '西瓜'],
  },
  {
    label: '肉禽蛋',
    codes: ['MEAT', 'POULTRY', 'EGG', 'PROCESSED_MEAT', 'EGG_DAIRY'],
    keywords: ['肉', '鸡', '鸭', '鹅', '牛', '羊', '猪', '排骨', '排', '翅', '腿', '蛋', '培根', '香肠', '火腿'],
  },
  {
    label: '水产海鲜',
    codes: ['AQUATIC', 'FISH', 'SEAFOOD', 'CRUSTACEAN', 'MOLLUSK'],
    keywords: ['鱼', '虾', '蟹', '贝', '蛤', '鱿', '海鲜', '甲壳'],
  },
  {
    label: '奶类乳品',
    codes: ['DAIRY', 'MILK', 'EGG_DAIRY'],
    keywords: ['奶', '乳', '酪', '黄油', '奶油'],
  },
  {
    label: '主食杂粮',
    codes: ['GRAIN_STAPLE', 'STAPLE', 'GRAIN'],
    keywords: ['米', '面', '馒头', '包子', '饺子', '水饺', '燕麦', '玉米', '意面', '饼', '粉'],
  },
  {
    label: '豆制品坚果',
    codes: ['LEGUME_SOY', 'LEGUME', 'HEALTHY_FAT'],
    keywords: ['豆', '腐', '核桃', '花生', '腰果', '杏仁', '坚果'],
  },
  {
    label: '菌菇海藻',
    codes: ['FUNGI', 'MUSHROOM'],
    keywords: ['菇', '菌', '木耳', '耳', '海带', '紫菜', '裙带菜'],
  },
  {
    label: '调味料',
    codes: ['SEASONING'],
    keywords: ['抽', '油', '醋', '酒', '盐', '糖', '酱', '粉', '精', '花椒', '八角', '调味'],
  },
  {
    label: '饮品',
    codes: ['BEVERAGE', 'WINE_BEVERAGE'],
    keywords: ['水', '酒', '茶', '可乐', '咖啡', '汁', '饮', '汽水', '红酒'],
  },
  {
    label: '即食加工',
    codes: ['PROCESSED_FOOD', 'PROCESSED_MEAT'],
    keywords: ['面', '肠', '三明治', '罐头', '汤圆', '烧麦', '加工', '即食', '香肠'],
  },
];

function dateAfterDays(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

interface Props {
  kind: ActionKind;
  householdId: string;
  inventory: InventoryView | null;
  /** 预选食材（从详情页进入时） */
  presetFoodId?: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * 手动操作弹窗，两步流程：填写 -> 确认卡片（docs/01 §7.3）。
 * 确认卡片显示动作、食材、数量、变更前后值。
 */
export function ActionModal({
  kind,
  householdId,
  inventory,
  presetFoodId,
  onClose,
  onDone,
}: Props) {
  const [foods, setFoods] = useState<FoodSummary[]>([]);
  const [categories, setCategories] = useState<FoodCategorySummary[]>([]);
  const [units, setUnits] = useState<UnitSummary[]>([]);
  const [foodId, setFoodId] = useState(presetFoodId ?? '');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [chosenFood, setChosenFood] = useState<FoodSummary | null>(null);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [customExpiryDays, setCustomExpiryDays] = useState('');
  const [reason, setReason] = useState(kind === 'DISCARD' ? 'SPOILED' : 'PHYSICAL_COUNT');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<FoodSummary[]>(`/households/${householdId}/foods`)
      .then(setFoods)
      .catch(() => setFoods([]));
  }, [householdId]);

  useEffect(() => {
    apiGet<FoodCategorySummary[]>('/food-categories')
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    apiGet<UnitSummary[]>('/units')
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  const selectedFood = useMemo(
    () => foods.find((food) => food.id === foodId) ?? chosenFood ?? undefined,
    [chosenFood, foodId, foods],
  );

  const categoryByCode = useMemo(
    () => new Map(categories.map((category) => [category.code, category])),
    [categories],
  );
  const visibleFoods = useMemo(() => {
    const group = FOOD_ENTRY_GROUPS.find((item) => item.label === selectedGroup);
    if (!group) return [];
    return foods.filter((food) => {
      let code: string | null | undefined = food.category_code;
      while (code) {
        if (group.codes.includes(code)) return true;
        code = categoryByCode.get(code)?.parent_code;
      }
      const fullName = (food.canonical_name + (food.category_path?.join('') ?? '')).toLowerCase();
      return group.keywords.some((kw) => fullName.includes(kw.toLowerCase()));
    });
  }, [categoryByCode, foods, selectedGroup]);

  const orderedUnits = useMemo(() => {
    const preferred = new Set(selectedFood?.preferred_unit_codes ?? []);
    return [...units].sort((left, right) => {
      const leftRank = preferred.has(left.code) ? 0 : 1;
      const rightRank = preferred.has(right.code) ? 0 : 1;
      return leftRank - rightRank;
    });
  }, [selectedFood, units]);

  useEffect(() => {
    if (selectedFood && !unit) setUnit(selectedFood.default_unit_code);
  }, [selectedFood, unit]);

  const quickQuantities = useMemo(() => {
    const unitKind = units.find((item) => item.code === unit)?.kind;
    if (selectedFood?.category_code === 'EGG' || selectedFood?.category_path?.includes('蛋类')) {
      return ['1', '5', '10', '20'];
    }
    if (unit === 'JIN') return ['0.5', '1', '2', '3'];
    if (unitKind === 'MASS') return ['100', '200', '300', '500', '1000'];
    if (unitKind === 'VOLUME') return ['250', '500', '1000'];
    return ['1', '2', '3', '5'];
  }, [selectedFood, unit, units]);

  function chooseFood(food: FoodSummary) {
    setFoodId(food.id);
    setChosenFood(food);
    setUnit(food.default_unit_code);
    setQuantity('');
    setExpiresAt('');
    setCustomExpiryDays('');
  }

  function chooseExpiryDays(days: number) {
    setExpiresAt(dateAfterDays(days));
    setCustomExpiryDays(String(days));
  }

  const currentTotal = useMemo(() => {
    if (!inventory || !foodId) return null;
    let total = 0;
    let itemUnit = '';
    for (const zone of inventory.zones) {
      for (const item of zone.items) {
        if (item.food_id === foodId) {
          total += Number(item.total_quantity);
          itemUnit = item.unit;
        }
      }
    }
    return { total, unit: itemUnit || selectedFood?.default_unit_code || '' };
  }, [inventory, foodId, selectedFood]);

  const afterTotal = useMemo(() => {
    if (currentTotal === null || quantity === '') return null;
    const q = Number(quantity);
    if (Number.isNaN(q)) return null;
    // 仅当单位与库存单位一致时显示前后对比；换算由服务端处理
    if (unit !== currentTotal.unit && currentTotal.total > 0) return null;
    switch (kind) {
      case 'ADD':
        return currentTotal.total + q;
      case 'CONSUME':
      case 'DISCARD':
        return currentTotal.total - q;
      case 'CORRECT':
        return q;
    }
  }, [currentTotal, quantity, unit, kind]);

  function buildPayload(): unknown {
    switch (kind) {
      case 'ADD':
        return {
          items: [
            {
              food_id: foodId,
              quantity,
              unit,
              ...(zoneId ? { storage_zone_id: zoneId } : {}),
              ...(expiresAt
                ? {
                    expires_at: new Date(`${expiresAt}T23:59:59`).toISOString(),
                    expiry_source: 'USER_CONFIRMED',
                  }
                : {}),
            },
          ],
        };
      case 'CONSUME':
        return { items: [{ food_id: foodId, quantity, unit }], purpose: 'UNKNOWN' };
      case 'DISCARD':
        return { items: [{ food_id: foodId, quantity, unit }], reason };
      case 'CORRECT':
        return { food_id: foodId, target_total_quantity: quantity, unit, reason };
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await executeCommand(householdId, COMMAND_TYPES[kind], buildPayload());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const formValid = foodId !== '' && quantity !== '' && Number(quantity) >= 0 && unit !== '';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal food-action-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{TITLES[kind]}</h3>

        {!confirming ? (
          <>
            {!presetFoodId ? (
              <>
                <div className="food-picker field">
                  <label>选择食材分类</label>
                  <div className="food-picker-chips" aria-label="食材分类">
                    {FOOD_ENTRY_GROUPS.map((group) => (
                      <button
                        type="button"
                        className={selectedGroup === group.label ? 'selected' : ''}
                        key={group.label}
                        onClick={() => {
                          setSelectedGroup((current) => current === group.label ? '' : group.label);
                        }}
                      >
                        {group.label}
                      </button>
                    ))}
                  </div>
                  <div className="food-choice-list" aria-live="polite">
                    {visibleFoods.map((food) => (
                      <button
                        type="button"
                        className={foodId === food.id ? 'selected' : ''}
                        key={food.id}
                        onClick={() => chooseFood(food)}
                      >
                        <strong>{food.canonical_name}</strong>
                      </button>
                    ))}
                    {selectedGroup && visibleFoods.length === 0 ? <p>这个分类暂时还没有可选食材。</p> : null}
                    {!selectedGroup ? <p>先点一种分类，再选择具体食材。</p> : null}
                  </div>
                </div>
              </>
            ) : null}

            {selectedFood ? (
              <div className="selected-food-summary">
                <span>已选食材</span>
                <strong>{selectedFood.canonical_name}</strong>
                {selectedFood.default_shelf_life_days ? <small>百科建议约 {selectedFood.default_shelf_life_days} 天内留意保鲜</small> : null}
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="quantity">{kind === 'CORRECT' ? '实际总量' : '数量'}</label>
              <input
                id="quantity"
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              {selectedFood ? (
                <div className="quick-choice-row" aria-label="常用数量">
                  {quickQuantities.map((value) => (
                    <button type="button" className={quantity === value ? 'selected' : ''} key={value} onClick={() => setQuantity(value)}>
                      {value} {unitLabel(unit)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="unit">单位</label>
              <select id="unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
                {orderedUnits.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.name_zh}
                  </option>
                ))}
              </select>
              {selectedFood?.preferred_unit_codes.length ? (
                <small style={{ color: 'var(--gray-500)' }}>
                  常用：{selectedFood.preferred_unit_codes.map(unitLabel).join('、')}
                </small>
              ) : null}
            </div>

            {kind === 'ADD' && inventory ? (
              <>
                <div className="field">
                  <label>存放区域</label>
                  <div className="quick-choice-row zone-choice-row">
                    <button type="button" className={zoneId === '' ? 'selected' : ''} onClick={() => setZoneId('')}>智能推荐</button>
                    {inventory.zones.map((zone) => (
                      <button type="button" className={zoneId === zone.zone_id ? 'selected' : ''} key={zone.zone_id} onClick={() => setZoneId(zone.zone_id)}>{zone.name}</button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>大概多久后到期？</label>
                  <div className="quick-choice-row" aria-label="快捷到期日">
                    <button type="button" className={expiresAt === '' ? 'selected' : ''} onClick={() => { setExpiresAt(''); setCustomExpiryDays(''); }}>按百科建议</button>
                    {QUICK_EXPIRY_DAYS.map((days) => (
                      <button type="button" className={expiresAt === dateAfterDays(days) ? 'selected' : ''} key={days} onClick={() => chooseExpiryDays(days)}>{days} 天后</button>
                    ))}
                  </div>
                  <div className="expiry-custom-input">
                    <span>其他：</span>
                    <input
                      aria-label="自定义到期天数"
                      type="number"
                      min="0"
                      inputMode="numeric"
                      placeholder="输入天数"
                      value={customExpiryDays}
                      onChange={(event) => {
                        const value = event.target.value;
                        setCustomExpiryDays(value);
                        const days = Number(value);
                        setExpiresAt(Number.isInteger(days) && days >= 0 ? dateAfterDays(days) : '');
                      }}
                    />
                    <span>天后</span>
                  </div>
                  {expiresAt ? <small className="expiry-preview">预计到期：{expiresAt.replaceAll('-', ' / ')}</small> : null}
                </div>
              </>
            ) : null}

            {kind === 'DISCARD' ? (
              <div className="field">
                <label htmlFor="discard-reason">丢弃原因</label>
                <select
                  id="discard-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  <option value="SPOILED">变质</option>
                  <option value="EXPIRED">过期</option>
                  <option value="DAMAGED">损坏</option>
                  <option value="OTHER">其他</option>
                </select>
              </div>
            ) : null}

            {kind === 'CORRECT' ? (
              <div className="field">
                <label htmlFor="correct-reason">修正理由</label>
                <select
                  id="correct-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  <option value="PHYSICAL_COUNT">实际清点</option>
                  <option value="INPUT_ERROR">录入错误</option>
                  <option value="OTHER">其他</option>
                </select>
              </div>
            ) : null}

            {error ? <div className="error-box">{error}</div> : null}

            <div className="actions">
              <button onClick={onClose}>取消</button>
              <button className="primary" disabled={!formValid} onClick={() => setConfirming(true)}>
                下一步
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="confirm-card">
              <div className="row">
                <span>操作</span>
                <strong>{TITLES[kind]}</strong>
              </div>
              <div className="row">
                <span>食材</span>
                <strong>{selectedFood?.canonical_name ?? '已选食材'}</strong>
              </div>
              <div className="row">
                <span>{kind === 'CORRECT' ? '修正为' : '数量'}</span>
                <strong>
                  {quantity} {unitLabel(unit)}
                </strong>
              </div>
              {currentTotal !== null && afterTotal !== null ? (
                <div className="row">
                  <span>库存变化</span>
                  <span className="before-after">
                    {currentTotal.total} → {afterTotal} {unitLabel(currentTotal.unit || unit)}
                  </span>
                </div>
              ) : null}
              {kind === 'DISCARD' || kind === 'CORRECT' ? (
                <div className="row">
                  <span>原因</span>
                  <span>{reason}</span>
                </div>
              ) : null}
            </div>
            {error ? <div className="error-box">{error}</div> : null}
            <div className="actions">
              <button onClick={() => setConfirming(false)}>返回修改</button>
              <button className="primary" disabled={busy} onClick={submit}>
                {busy ? '执行中…' : '确认执行'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
