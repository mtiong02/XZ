/**
 * 拼音近音/同音字智能纠错引擎 (Phonetic Homophone Matcher)
 * 解决 ASR 语音识别常见同音字/近音字/声调差异混淆问题（例如 "结束兑换" -> "结束对话"）。
 *
 * v2: 扩充食材拼音库，新增 phoneticFoodMatch 食材级别纠错。
 */

// 常用汉字 -> 无声调拼音映射表
const PINYIN_MAP: Record<string, string> = {
  // ---- 意图/控制类 ----
  结: 'jie',
  解: 'jie',
  截: 'jie',
  束: 'shu',
  速: 'shu',
  宿: 'shu',
  树: 'shu',
  数: 'shu',
  对: 'dui',
  兑: 'dui',
  队: 'dui',
  话: 'hua',
  换: 'huan',
  画: 'hua',
  华: 'hua',
  划: 'hua',
  掉: 'diao',
  退: 'tui',
  出: 'chu',
  关: 'guan',
  闭: 'bi',
  停: 'ting',
  止: 'zhi',
  拜: 'bai',
  再: 'zai',
  见: 'jian',
  算: 'suan',
  了: 'le',
  是: 'shi',
  的: 'de',
  确: 'que',
  认: 'ren',
  错: 'cuo',
  没: 'mei',
  好: 'hao',
  行: 'xing',
  嗯: 'en',
  不: 'bu',
  要: 'yao',
  想: 'xiang',
  取: 'qu',
  消: 'xiao',
  加: 'jia',
  添: 'tian',
  用: 'yong',
  吃: 'chi',
  喝: 'he',
  买: 'mai',
  卖: 'mai',
  放: 'fang',
  存: 'cun',
  做: 'zuo',
  煮: 'zhu',
  炒: 'chao',

  // ---- 食材核心用字 ----
  鸡: 'ji',
  机: 'ji',
  及: 'ji',
  级: 'ji',
  胸: 'xiong',
  肉: 'rou',
  猪: 'zhu',
  牛: 'niu',
  羊: 'yang',
  鱼: 'yu',
  虾: 'xia',
  蟹: 'xie',
  蛋: 'dan',
  奶: 'nai',
  油: 'you',
  土: 'tu',
  豆: 'dou',
  番: 'fan',
  茄: 'qie',
  西: 'xi',
  红: 'hong',
  柿: 'shi',
  苹: 'ping',
  果: 'guo',
  菜: 'cai',
  排: 'pai',
  骨: 'gu',
  翅: 'chi',
  腿: 'tui',
  爪: 'zhua',
  掌: 'zhang',
  腩: 'nan',
  南: 'nan',
  仁: 'ren',
  人: 'ren',
  但: 'dan',

  // ---- 蔬菜/调味料/药膳 ----
  葱: 'cong',
  姜: 'jiang',
  蒜: 'suan',
  椒: 'jiao',
  辣: 'la',
  盐: 'yan',
  糖: 'tang',
  醋: 'cu',
  酱: 'jiang',
  腐: 'fu',
  付: 'fu',
  乳: 'ru',
  腊: 'la',
  蘑: 'mo',
  菇: 'gu',
  蕈: 'xun',
  笋: 'sun',
  藕: 'ou',
  芹: 'qin',
  韭: 'jiu',
  莲: 'lian',
  芽: 'ya',
  薯: 'shu',
  瓜: 'gua',
  萝: 'luo',
  卜: 'bo',
  菠: 'bo',
  白: 'bai',
  莱: 'lai',
  芥: 'jie',
  茴: 'hui',
  桂: 'gui',
  皮: 'pi',
  核: 'he',
  枣: 'zao',
  薏: 'yi',
  斛: 'hu',
  桃: 'tao',
  梨: 'li',
  橘: 'ju',
  柑: 'gan',
  橙: 'cheng',
  柠: 'ning',
  檬: 'meng',
  蕉: 'jiao',
  莓: 'mei',
  桑: 'sang',
  荔: 'li',
  枝: 'zhi',
  柚: 'you',
  李: 'li',
  杏: 'xing',
  芒: 'mang',
  榴: 'liu',
  栗: 'li',
  松: 'song',
  花: 'hua',

  // ---- 海鲜/水产 ----
  鲤: 'li',
  鲫: 'ji',
  鲈: 'lu',
  鲑: 'gui',
  鳕: 'xue',
  鲍: 'bao',
  蚝: 'hao',
  耗: 'hao',
  蛤: 'ge',
  贝: 'bei',
  蚌: 'bang',
  鱿: 'you',
  墨: 'mo',
  章: 'zhang',
  沙: 'sha',
  巴: 'ba',

  // ---- 位置/动作 ----
  移: 'yi',
  动: 'dong',
  冷: 'leng',
  藏: 'cang',
  冻: 'dong',
  室: 'shi',
  库: 'ku',
  柜: 'gui',
  保: 'bao',
  鲜: 'xian',
  温: 'wen',
  常: 'chang',

  // ---- 量词/数词常见误识别 ----
  半: 'ban',
  两: 'liang',
  打: 'da',
  扎: 'zha',
  墩: 'dun',
  碗: 'wan',
  勺: 'shao',
  杯: 'bei',
  碟: 'die',
  筐: 'kuang',
  篮: 'lan',
};

/**
 * 将中文文本转换为无声调拼音序列
 */
export function textToPinyin(text: string): string[] {
  const clean = text.replace(/[\s，。！？、,.!?：:；;"""'''`]/g, '');
  const pyList: string[] = [];
  for (const char of clean) {
    pyList.push(PINYIN_MAP[char] ?? char.toLowerCase());
  }
  return pyList;
}

/**
 * 计算两个拼音/文本序列的相似度 (Levenshtein Distance 归一化)
 */
export function pinyinSimilarity(source: string, target: string): number {
  const pySource = textToPinyin(source).join('');
  const pyTarget = textToPinyin(target).join('');

  if (pySource === pyTarget) return 1.0;
  if (!pySource || !pyTarget) return 0.0;

  const len1 = pySource.length;
  const len2 = pyTarget.length;
  const matrix: number[][] = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) {
    const row = matrix[i];
    if (row) row[0] = i;
  }
  const firstRow = matrix[0];
  if (firstRow) {
    for (let j = 0; j <= len2; j++) firstRow[j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    const row = matrix[i];
    const prevRow = matrix[i - 1];
    if (!row || !prevRow) continue;
    for (let j = 1; j <= len2; j++) {
      const cost = pySource[i - 1] === pyTarget[j - 1] ? 0 : 1;
      const top = (prevRow[j] ?? 0) + 1;
      const left = (row[j - 1] ?? 0) + 1;
      const diag = (prevRow[j - 1] ?? 0) + cost;
      row[j] = Math.min(top, left, diag);
    }
  }

  const distance = matrix[len1]?.[len2] ?? 0;
  const maxLen = Math.max(len1, len2);
  return 1 - distance / maxLen;
}

/** 预置的标准退出会话模式 */
const CANONICAL_EXIT_PHRASES = [
  '结束对话',
  '退出对话',
  '关闭对话',
  '停止对话',
  '不用了拜拜',
  '再见拜拜',
  '你先退下吧',
  '先这样吧',
  '不聊了',
  '散了吧',
  '我忙去了',
  '差不多了',
  '我先走了',
];

/**
 * 智能判定输入文本是否与"结束/退出对话"意图近音相似
 */
export function isPhoneticallyExit(rawText: string): boolean {
  const clean = rawText.replace(/[\s，。！？、,.!?：:；;"""''']/g, '');
  if (!clean || /结束后提醒/.test(clean)) return false;

  // 1. 如果包含明确关键字前缀
  if (/^(?:结束|退出|关闭|停止|退下|拜拜|再见|取消|算了|不聊了|散了|差不多了)+/i.test(clean)) {
    return true;
  }

  // 2. 切块/滑窗拼音匹配 (应对"结束对话结束对话"、"结束兑换"等长短不一重复情况)
  for (const canonical of CANONICAL_EXIT_PHRASES) {
    if (pinyinSimilarity(clean, canonical) >= 0.78) {
      return true;
    }
    // 对长短句取子串比对
    if (clean.length >= canonical.length) {
      const sub = clean.slice(0, canonical.length);
      if (pinyinSimilarity(sub, canonical) >= 0.78) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 拼音模糊食材匹配：当精确文本匹配失败时，用拼音相似度在 catalog 中找最佳候选。
 *
 * @param rawName 用户说出的、未在 catalog 中精确命中的食材名片段
 * @param catalogNames 所有 catalog 中的 canonicalName + aliases
 * @param threshold 相似度阈值，默认 0.80
 * @returns 最佳匹配结果，或 null
 */
export function phoneticFoodMatch(
  rawName: string,
  catalogNames: { name: string; id: string; canonicalName: string }[],
  threshold = 0.8,
): { id: string; canonicalName: string; matchedName: string; similarity: number } | null {
  if (!rawName || rawName.length < 2) return null;

  let bestMatch: {
    id: string;
    canonicalName: string;
    matchedName: string;
    similarity: number;
  } | null = null;

  for (const entry of catalogNames) {
    const sim = pinyinSimilarity(rawName, entry.name);
    if (sim >= threshold && (bestMatch === null || sim > bestMatch.similarity)) {
      bestMatch = {
        id: entry.id,
        canonicalName: entry.canonicalName,
        matchedName: entry.name,
        similarity: sim,
      };
    }
  }

  return bestMatch;
}
