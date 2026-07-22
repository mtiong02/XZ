import { describe, expect, it } from 'vitest';
import { interpretReply, isDialogueExit, relativeInventoryFraction } from './reply-interpreter';
import type { FoodCatalogEntry } from '../parser/intent-parser';

const catalog: FoodCatalogEntry[] = [
  { id: 'f-egg', canonicalName: '鸡蛋', defaultUnitCode: 'piece', aliases: ['蛋', 'egg'] },
  { id: 'f-milk', canonicalName: '牛奶', defaultUnitCode: 'box', aliases: ['milk'] },
];

describe('interpretReply', () => {
  it('recognizes plain confirmation', () => {
    for (const yes of ['对', '对的', '是的', '是', '是的对', '是对', '是的对是的对', '对的确认', '没错', '好的', '确认', 'yes', 'OK']) {
      expect(interpretReply(yes, catalog).kind).toBe('CONFIRM');
    }
  });

  it('recognizes plain rejection', () => {
    for (const no of ['不对', '取消', '算了', '错了', '结束对话谢谢', '取消这', 'cancel']) {
      expect(interpretReply(no, catalog).kind).toBe('REJECT');
    }
  });

  it('treats "不是两盒是三盒" as a CORRECTION targeting the LAST quantity (3, not 2)', () => {
    const result = interpretReply('不是两盒是三盒', catalog);
    expect(result.kind).toBe('CORRECTION');
    if (result.kind === 'CORRECTION') {
      expect(result.hasFood).toBe(false);
      expect(result.bareQuantity).toEqual({ quantity: '3', unit: 'box' });
    }
  });

  it('treats "改成三盒" as a quantity CORRECTION', () => {
    const result = interpretReply('改成三盒', catalog);
    expect(result.kind).toBe('CORRECTION');
    if (result.kind === 'CORRECTION') {
      expect(result.bareQuantity).toEqual({ quantity: '3', unit: 'box' });
    }
  });

  it('treats "是三个鸡蛋" as a food+quantity CORRECTION', () => {
    const result = interpretReply('是三个鸡蛋', catalog);
    expect(result.kind).toBe('CORRECTION');
    if (result.kind === 'CORRECTION') {
      expect(result.hasFood).toBe(true);
      expect(result.items[0]?.food_id).toBe('f-egg');
      expect(result.items[0]?.quantity).toBe('3');
    }
  });

  it('returns UNCLEAR for unrelated speech', () => {
    expect(interpretReply('今天天气不错', catalog).kind).toBe('UNCLEAR');
  });

  it.each(['结束对话', '结束兑换', '退出本次绘话', '我要结束对话了', '你先退下吧'])(
    'treats session exit as rejection: %s',
    (text) => {
      expect(isDialogueExit(text)).toBe(true);
      expect(interpretReply(text, catalog).kind).toBe('REJECT');
    },
  );

  it('does not treat a later reminder as session exit', () => {
    expect(isDialogueExit('结束后提醒我买牛奶')).toBe(false);
  });

  it('recognizes a short polite ending', () => {
    expect(isDialogueExit('好谢谢结束')).toBe(true);
    expect(isDialogueExit('好的谢谢结束')).toBe(true);
  });

  it.each(['用掉一半吧', '吃掉半数', '使用50%'])(
    'recognizes half of current inventory: %s',
    (text) => {
      expect(relativeInventoryFraction(text)).toBe('0.5');
    },
  );
});
