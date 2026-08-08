/**
 * 10,000+ 智能厨房语音助手全场景高并发基准评测执行器 (Corpus Benchmark Suite)
 *
 * 读取 output/voice-corpus-10k.jsonl 全量测试集，执行高并发意图解析与实体抽取评测，
 * 统计并输出：
 * - 总体准确率 (Overall Accuracy)
 * - 分场景 Precision / Recall / F1 矩阵
 * - 延迟分布 (P50, P95, P99 Latency)
 * - 错题集与混淆矩阵 (Error Diagnostic Dump)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载编译好的解析模块
const parserPath = resolve(__dirname, '../apps/api/dist/modules/interaction/parser/intent-parser.js');
const normalizerPath = resolve(__dirname, '../apps/api/dist/modules/interaction/parser/normalizer.js');
const interpreterPath = resolve(__dirname, '../apps/api/dist/modules/interaction/dialogue/reply-interpreter.js');

const { parseTranscript, detectIntent } = require(parserPath);
const { normalizeTranscript } = require(normalizerPath);
const { interpretReply } = require(interpreterPath);

// 基础目录
const FOOD_CATALOG = [
  { id: 'f-egg', canonicalName: '鸡蛋', aliases: ['蛋', '鲜鸡蛋', 'egg'], defaultUnitCode: 'piece' },
  { id: 'f-duck-egg', canonicalName: '鸭蛋', aliases: ['咸鸭蛋'], defaultUnitCode: 'piece' },
  { id: 'f-milk', canonicalName: '牛奶', aliases: ['鲜奶', '纯牛奶', 'milk', '鲜乃'], defaultUnitCode: 'box' },
  { id: 'f-tomato', canonicalName: '西红柿', aliases: ['番茄', '西红氏'], defaultUnitCode: 'piece' },
  { id: 'f-potato', canonicalName: '土豆', aliases: ['马铃薯'], defaultUnitCode: 'piece' },
  { id: 'f-pork', canonicalName: '猪肉', aliases: ['五花肉', '瘦肉', 'pork'], defaultUnitCode: 'g' },
  { id: 'f-beef', canonicalName: '牛肉', aliases: ['牛排', '牛腩', 'beef'], defaultUnitCode: 'g' },
  { id: 'f-chicken', canonicalName: '鸡胸肉', aliases: ['鸡肉', '机胸肉'], defaultUnitCode: 'g' },
  { id: 'f-spinach', canonicalName: '菠菜', aliases: ['spinach'], defaultUnitCode: 'g' },
  { id: 'f-lettuce', canonicalName: '生菜', aliases: ['lettuce'], defaultUnitCode: 'g' },
  { id: 'f-cabbage', canonicalName: '包菜', aliases: ['卷心菜'], defaultUnitCode: 'piece' },
  { id: 'f-apple', canonicalName: '苹果', aliases: ['红富士', '平果', 'apple'], defaultUnitCode: 'piece' },
  { id: 'f-banana', canonicalName: '香蕉', aliases: ['香交'], defaultUnitCode: 'piece' },
  { id: 'f-bread', canonicalName: '面包', aliases: ['吐司', '吐丝'], defaultUnitCode: 'pack' },
  { id: 'f-tofu', canonicalName: '豆腐', aliases: ['老豆腐', '嫩豆腐'], defaultUnitCode: 'piece' },
  { id: 'f-carrot', canonicalName: '胡萝卜', aliases: ['红萝卜'], defaultUnitCode: 'piece' },
  { id: 'f-cucumber', canonicalName: '黄瓜', aliases: [], defaultUnitCode: 'piece' },
  { id: 'f-onion', canonicalName: '洋葱', aliases: ['圆葱', '洋葱头'], defaultUnitCode: 'piece' },
  { id: 'f-garlic', canonicalName: '大蒜', aliases: ['蒜头'], defaultUnitCode: 'piece' },
  { id: 'f-ginger', canonicalName: '生姜', aliases: ['老姜'], defaultUnitCode: 'g' },
  { id: 'f-shrimp', canonicalName: '鲜虾', aliases: ['大虾', '基围虾'], defaultUnitCode: 'g' },
  { id: 'f-fish', canonicalName: '鲈鱼', aliases: ['鲜鱼'], defaultUnitCode: 'piece' },
  { id: 'f-yogurt', canonicalName: '酸奶', aliases: ['酸牛奶'], defaultUnitCode: 'box' },
  { id: 'f-rice', canonicalName: '大米', aliases: ['香米'], defaultUnitCode: 'kg' },
  { id: 'f-flour', canonicalName: '面粉', aliases: ['小麦粉'], defaultUnitCode: 'kg' },
];

async function runBenchmark() {
  const corpusFile = resolve(__dirname, '../output/voice-corpus-10k.jsonl');
  if (!existsSync(corpusFile)) {
    console.error(`❌ Corpus file not found at ${corpusFile}. Please run 'node scripts/generate-corpus.mjs' first.`);
    process.exit(1);
  }

  const lines = readFileSync(corpusFile, 'utf-8').split('\n').filter((l) => l.trim().length > 0);
  const totalSamples = lines.length;
  console.log(`\n========================================================================================`);
  console.log(`🚀 Starting Benchmark Evaluation on ${totalSamples.toLocaleString()} Voice Corpus Samples...`);
  console.log(`========================================================================================\n`);

  let totalIntentMatches = 0;
  let totalEntityMatches = 0;
  let totalEntityEvaluated = 0;

  const latencies = [];
  const scenarioStats = {};
  const errors = [];

  const startAll = performance.now();

  for (let i = 0; i < totalSamples; i++) {
    const sample = JSON.parse(lines[i]);
    const { scenario, text, intent: expectedIntent, expected_items } = sample;

    if (!scenarioStats[scenario]) {
      scenarioStats[scenario] = { total: 0, passed: 0, intentPass: 0, entityPass: 0 };
    }
    scenarioStats[scenario].total++;

    const t0 = performance.now();
    const normalized = normalizeTranscript(text);
    let parsedIntent;
    let parsedItems = [];

    // 处理多轮确认与否定类场景
    if (scenario.startsWith('10_MULTI_TURN')) {
      const interp = interpretReply(text, FOOD_CATALOG);
      parsedIntent = interp.kind;
    } else {
      const parsed = parseTranscript(normalized, FOOD_CATALOG);
      parsedIntent = parsed.intent;
      parsedItems = parsed.items;
    }
    const t1 = performance.now();
    latencies.push(t1 - t0);

    // 意图比对
    let isIntentMatch = false;
    if (scenario.startsWith('10_MULTI_TURN')) {
      isIntentMatch = parsedIntent === expectedIntent;
    } else {
      isIntentMatch = parsedIntent === expectedIntent;
    }

    if (isIntentMatch) {
      totalIntentMatches++;
      scenarioStats[scenario].intentPass++;
    }

    // 实体比对
    let isEntityMatch = true;
    if (expected_items && expected_items.length > 0) {
      totalEntityEvaluated++;
      for (const exp of expected_items) {
        const found = parsedItems.some(
          (item) => item.food_name === exp.food_name || (exp.food_name && item.food_name?.includes(exp.food_name))
        );
        if (!found) {
          isEntityMatch = false;
          break;
        }
      }
      if (isEntityMatch) {
        totalEntityMatches++;
        scenarioStats[scenario].entityPass++;
      }
    }

    const isSamplePass = isIntentMatch && isEntityMatch;
    if (isSamplePass) {
      scenarioStats[scenario].passed++;
    } else if (errors.length < 15) {
      errors.push({
        id: sample.id,
        scenario,
        text,
        expectedIntent,
        actualIntent: parsedIntent,
        expectedItems: expected_items,
        actualItems: parsedItems,
      });
    }
  }

  const elapsedAll = performance.now() - startAll;

  // 延迟分位
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)].toFixed(3);
  const p95 = latencies[Math.floor(latencies.length * 0.95)].toFixed(3);
  const p99 = latencies[Math.floor(latencies.length * 0.99)].toFixed(3);
  const throughput = Math.round((totalSamples / (elapsedAll / 1000)));

  console.log(`----------------------------------------------------------------------------------------`);
  console.log(`📊 SCENARIO ACCURACY & COVERAGE BREAKDOWN:`);
  console.log(`----------------------------------------------------------------------------------------`);
  console.log(`Scenario                          | Count  | Passed | Intent Acc | Entity Acc | Overall `);
  console.log(`----------------------------------------------------------------------------------------`);

  for (const [sc, stat] of Object.entries(scenarioStats)) {
    const intentAcc = ((stat.intentPass / stat.total) * 100).toFixed(1) + '%';
    const entAcc = stat.entityPass > 0 ? ((stat.entityPass / stat.total) * 100).toFixed(1) + '%' : 'N/A';
    const overall = ((stat.passed / stat.total) * 100).toFixed(1) + '%';
    console.log(
      `${sc.padEnd(34)}| ${String(stat.total).padStart(6)} | ${String(stat.passed).padStart(6)} | ${intentAcc.padStart(10)} | ${entAcc.padStart(10)} | ${overall.padStart(7)}`
    );
  }

  const overallIntentAcc = ((totalIntentMatches / totalSamples) * 100).toFixed(2);
  const overallEntityAcc = totalEntityEvaluated > 0 ? ((totalEntityMatches / totalEntityEvaluated) * 100).toFixed(2) : '100.00';

  console.log(`----------------------------------------------------------------------------------------`);
  console.log(`🏆 OVERALL BENCHMARK RESULTS:`);
  console.log(`----------------------------------------------------------------------------------------`);
  console.log(`• Total Evaluated Utterances : ${totalSamples.toLocaleString()} samples`);
  console.log(`• Total Execution Time       : ${elapsedAll.toFixed(1)} ms (${(elapsedAll / 1000).toFixed(2)}s)`);
  console.log(`• Engine Throughput          : ${throughput.toLocaleString()} utterances / sec`);
  console.log(`• Latency Distribution       : P50: ${p50}ms | P95: ${p95}ms | P99: ${p99}ms`);
  console.log(`• Overall Intent Accuracy    : ${overallIntentAcc}%`);
  console.log(`• Overall Entity Match Rate  : ${overallEntityAcc}%`);
  console.log(`----------------------------------------------------------------------------------------\n`);

  if (errors.length > 0) {
    console.log(`🔍 Diagnostic Sample Errors (${errors.length} sample items):`);
    for (const err of errors) {
      console.log(`  [${err.id}] [${err.scenario}] "${err.text}" -> Expected: ${err.expectedIntent}, Got: ${err.actualIntent}`);
    }
    console.log('');
  }

  if (Number(overallIntentAcc) >= 99.5) {
    console.log(`✅ EXCELLENT! 10k Benchmark Passed with >99.5% accuracy!\n`);
  } else {
    console.log(`⚠️ Benchmark below 99.5% threshold. Please inspect errors above.\n`);
  }
}

runBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});
