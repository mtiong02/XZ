import { describe, expect, it } from 'vitest';
import { normalizeTranscript } from './normalizer';
import { parseTranscript, type FoodCatalogEntry } from './intent-parser';
import {
  interpretReply,
  isDialogueExit,
  relativeInventoryFraction,
} from '../dialogue/reply-interpreter';
import { normalizeBareDinerReply, parseMealContext } from '../dialogue/meal-recommendations';
import { parseReminderSchedule } from '../../notification/notification.service';

/**
 * 真实内测对话回归集（2026-07-22 ~ 07-23 线上会话）。
 *
 * 每条用例都来自用户实际说过的话与当时的错误结果，用于防止同类失败复发。
 * 失败模式编号对应产品复盘：P0-1 同食材重复、P0-3 单位拦截、P0-4 确认/修正、P0-5 全量语义。
 */

const catalog: FoodCatalogEntry[] = [
  { id: 'f-chicken-breast', canonicalName: '鸡胸肉', defaultUnitCode: 'g', aliases: ['鸡胸'] },
  { id: 'f-pork-rib', canonicalName: '排骨', defaultUnitCode: 'g', aliases: ['猪排骨'] },
  { id: 'f-carrot', canonicalName: '胡萝卜', defaultUnitCode: 'piece', aliases: [] },
  { id: 'f-broccoli', canonicalName: '西兰花', defaultUnitCode: 'piece', aliases: [] },
  { id: 'f-lamb', canonicalName: '羊肉', defaultUnitCode: 'g', aliases: [] },
  { id: 'f-shiitake', canonicalName: '香菇', defaultUnitCode: 'g', aliases: [] },
  { id: 'f-yogurt', canonicalName: '酸奶', defaultUnitCode: 'box', aliases: [] },
  { id: 'f-tomato', canonicalName: '西红柿', defaultUnitCode: 'piece', aliases: ['番茄'] },
  { id: 'f-soybean', canonicalName: '黄豆', defaultUnitCode: 'g', aliases: [] },
];

const parse = (raw: string) => parseTranscript(normalizeTranscript(raw), catalog);

describe('P0-1 同一食材不得被拆成两条（幽灵 1 克）', () => {
  it('“鸡胸肉已经被我吃完了用掉两百五十克鸡胸肉” 只产出 1 条 250 克', () => {
    const result = parse('然后鸡胸肉已经被我吃完了用掉两百五十克鸡胸肉');
    const chicken = result.items.filter((i) => i.food_name.includes('鸡胸'));
    expect(chicken).toHaveLength(1);
    expect(chicken[0]?.quantity).toBe('250');
    expect(chicken[0]?.unit).toBe('g');
  });

  it('同食材重复出现时不保留 quantity_explicit=false 的兜底条目', () => {
    const result = parse('西红柿被我用完了用掉五个西红柿');
    const tomato = result.items.filter((i) => i.food_name.includes('西红柿'));
    expect(tomato).toHaveLength(1);
    expect(tomato[0]?.quantity).toBe('5');
  });
});

describe('P0-10 裸声明默认入库（07/22 段4：列货省略动词，逐句被追问“是要添加还是查询”）', () => {
  it('“薏米一盒”这类无动词的食材+数量默认按添加处理', () => {
    // 用目录里已有的食材复现同一现象（酸奶=box、羊肉=g）
    const yogurt = parse('酸奶一盒');
    expect(yogurt.intent).toBe('ADD_INVENTORY');
    expect(yogurt.items[0]?.food_name).toContain('酸奶');
    expect(yogurt.items[0]?.quantity).toBe('1');

    const lamb = parse('六斤羊肉');
    expect(lamb.intent).toBe('ADD_INVENTORY');
    expect(lamb.items[0]?.quantity).toBe('6');
    expect(lamb.items[0]?.unit).toBe('jin');
  });

  it('无明确数量时不擅自默认入库（仍交由澄清）', () => {
    // “还有多少鸡蛋”是查询；“鸡胸肉”单独出现无数量，不应被当成添加
    expect(parse('鸡胸肉').intent).not.toBe('ADD_INVENTORY');
  });

  it('已有明确动词时不被裸声明规则覆盖', () => {
    expect(parse('用掉两盒酸奶').intent).toBe('CONSUME_INVENTORY');
    expect(parse('扔了三个西红柿').intent).toBe('DISCARD_INVENTORY');
  });
});

describe('P0-2 多食材一句话不得静默丢失', () => {
  it('“五百克排骨 + 一根胡萝卜 + 一颗西兰花” 三样都在', () => {
    const result = parse('我买了五百克的排骨然后一根胡萝卜然后一颗西兰花');
    const names = result.items.map((i) => i.food_name);
    expect(names.some((n) => n.includes('排骨'))).toBe(true);
    expect(names.some((n) => n.includes('胡萝卜'))).toBe(true);
    expect(names.some((n) => n.includes('西兰花'))).toBe(true);
    const rib = result.items.find((i) => i.food_name.includes('排骨'));
    expect(rib?.quantity).toBe('500');
  });
});

describe('P0-3 中文日常单位必须被接受，不得逼用户换算', () => {
  it('“三斤羊肉” 接受斤，不判为不合理单位', () => {
    const result = parse('我想添加三斤羊肉');
    const lamb = result.items.find((i) => i.food_name.includes('羊肉'));
    expect(lamb?.quantity).toBe('3');
    expect(lamb?.unit_reasonable).toBe(true);
  });

  it('“加一袋香菇” 接受袋', () => {
    const result = parse('加一袋香菇');
    const item = result.items.find((i) => i.food_name.includes('香菇'));
    expect(item?.unit_reasonable).toBe(true);
  });
});

describe('P0-4 确认词与修正判定', () => {
  it('“是的用” / “是的用掉了” 视为确认', () => {
    expect(interpretReply('是的用', catalog).kind).toBe('CONFIRM');
    expect(interpretReply('是的用掉了', catalog).kind).toBe('CONFIRM');
  });

  it('“不是的我只用掉一” 是修正为 1，不是取消', () => {
    const result = interpretReply('不是的我只用掉一', catalog);
    expect(result.kind).toBe('CORRECTION');
  });

  it('“对的是” 视为确认', () => {
    expect(interpretReply('对的是', catalog).kind).toBe('CONFIRM');
  });
});

describe('P0-5 “全部/都吃完了” 语义', () => {
  it('识别整体消耗表达', () => {
    expect(relativeInventoryFraction('鸡胸肉都被我吃完')).toBe('1.0');
    expect(relativeInventoryFraction('所有的全用掉')).toBe('1.0');
    expect(relativeInventoryFraction('把所有鸡胸肉删除就可以了')).toBe('1.0');
  });

  it('“所有的黄豆三百克”在确认轮以最后数量覆盖旧候选', () => {
    const result = interpretReply('不是一克黄豆，是所有的黄豆三百克', catalog);
    expect(result.kind).toBe('CORRECTION');
    if (result.kind === 'CORRECTION') {
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ food_id: 'f-soybean', quantity: '300', unit: 'g' });
    }
  });
});

describe('P0-6 追问“几个人吃”后裸数字回答必须被接受（07/23 死循环会话）', () => {
  it('“两个”补全为可识别的人数', () => {
    expect(normalizeBareDinerReply('两个')).toBe('2个人');
    expect(normalizeBareDinerReply('俩')).toBe('2个人');
    expect(normalizeBareDinerReply('就2个')).toBe('2个人');
    expect(normalizeBareDinerReply('三个人吃')).toBe('3个人');
  });

  it('补全后 parseMealContext 能取到人数（原句合并场景）', () => {
    const combined = `想吃两人份下午茶要清淡少油，${normalizeBareDinerReply('两个')}`;
    expect(parseMealContext(combined).dinerCount).toBe(2);
  });

  it('带食材数量的正常语句不被误改', () => {
    expect(normalizeBareDinerReply('用了2个鸡蛋')).toBe('用了2个鸡蛋');
    expect(normalizeBareDinerReply('加两盒牛奶')).toBe('加两盒牛奶');
  });
});

describe('P0-7 结束对话：礼貌语在前也必须退出（07/22 用户投诉“结束了还在监听”）', () => {
  it('礼貌语前置的结束表达', () => {
    for (const phrase of [
      '好的谢谢结束',
      '谢谢结束',
      '谢谢你结束对话',
      '辛苦了结束',
      '好的谢谢再见',
      '谢谢拜拜',
      '没有有的的退下吧',
    ]) {
      expect(isDialogueExit(phrase)).toBe(true);
    }
  });

  it('原有形态不回退', () => {
    for (const phrase of ['结束', '结束对话', '好的结束', '结束兑换', '拜拜']) {
      expect(isDialogueExit(phrase)).toBe(true);
    }
  });

  it('不误伤正常业务语句', () => {
    for (const phrase of ['结束后提醒我', '谢谢，帮我加两盒牛奶', '推荐一份晚餐']) {
      expect(isDialogueExit(phrase)).toBe(false);
    }
  });
});

describe('P1 提醒时间按家庭时区解析（07/23 “九点变17:00”会话）', () => {
  // 用户 00:34（北京 07/23）说“明天早上九点”：应得北京 07/24 09:00 = UTC 07/24 01:00
  const now = new Date('2026-07-22T16:34:00Z'); // = 北京 07/23 00:34

  it('“明天早上九点钟提醒我” -> 北京时间次日 09:00', () => {
    const parsed = parseReminderSchedule('明天早上九点钟提醒我', now, 'Asia/Shanghai');
    expect(parsed?.toISOString()).toBe('2026-07-24T01:00:00.000Z');
  });

  it('“明天下午三点” 12 小时口语转 24 小时 -> 15:00', () => {
    const parsed = parseReminderSchedule('明天下午三点提醒我', now, 'Asia/Shanghai');
    expect(parsed?.toISOString()).toBe('2026-07-24T07:00:00.000Z');
  });

  it('非法时区回退 Asia/Shanghai，不抛错', () => {
    const parsed = parseReminderSchedule('明天早上9点提醒我', now, 'not-a-timezone');
    expect(parsed?.toISOString()).toBe('2026-07-24T01:00:00.000Z');
  });
});

describe('P0-8 方言量词与大数归一化', () => {
  it('“一打酸奶” 识别为 12盒', () => {
    const yogurt = parse('买了一打酸奶');
    expect(yogurt.items[0]?.quantity).toBe('12');
  });

  it('“两扎香菇” 识别为 2把', () => {
    const shiitake = parse('加两扎香菇');
    expect(shiitake.items[0]?.unit).toBe('bunch');
  });
});

describe('P0-9 增量修正与分数表达', () => {
  it('“多加一个” 识别为增量修正', () => {
    const result = interpretReply('多加一个西红柿', catalog);
    expect(result.kind).toBe('CORRECTION');
    if (result.kind === 'CORRECTION') {
      expect(result.incremental).toBe(true);
    }
  });

  it('“吃掉三分之一” 识别为 0.333 比例', () => {
    expect(relativeInventoryFraction('把西兰花吃掉三分之一')).toBe('0.333');
    expect(relativeInventoryFraction('吃掉四分之一')).toBe('0.250');
  });
});
