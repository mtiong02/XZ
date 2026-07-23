export type ProductInsightSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface VoiceJobForInsight {
  status: string;
  error_code: string | null;
  transcript_raw: string | null;
  turn_count: number | string | null;
  dialogue_turns: Array<{ role?: string; text?: string }> | null;
}

export interface ProductInsight {
  id: string;
  area: string;
  severity: ProductInsightSeverity;
  confidence: 'HIGH' | 'MEDIUM';
  title: string;
  finding: string;
  evidence: string[];
  recommendation: string;
  acceptance_criteria: string[];
}

function countBy<T>(values: T[]): Map<T, number> {
  return values.reduce((result, value) => {
    result.set(value, (result.get(value) ?? 0) + 1);
    return result;
  }, new Map<T, number>());
}

function percentage(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function topPhrases(jobs: VoiceJobForInsight[], max = 3): Array<{ text: string; count: number }> {
  return Array.from(
    countBy(
      jobs.map((job) => job.transcript_raw?.trim()).filter((text): text is string => Boolean(text)),
    ).entries(),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, max)
    .map(([text, count]) => ({ text, count }));
}

/**
 * 将语音任务日志转为可审计的产品改进候选项。
 * 这是证据规则层：它绝不执行产品写入，也不把推测伪装成用户事实。
 * 后续 LLM 仅可在此结构之上改写说明，不能绕开 evidence/acceptance_criteria。
 */
export function buildProductInsights(jobs: VoiceJobForInsight[]): {
  summary: { headline: string; detail: string };
  metrics: Array<{ label: string; value: string; description: string }>;
  insights: ProductInsight[];
  limitations: string[];
} {
  const total = jobs.length;
  const ambiguous = jobs.filter((job) => job.error_code === 'AMBIGUOUS_COMMAND');
  const failed = jobs.filter((job) => job.status === 'FAILED');
  const longTurns = jobs.filter((job) => Number(job.turn_count ?? 0) >= 4);
  const missingTranscript = jobs.filter((job) => !job.transcript_raw?.trim());
  const averageTurns = total
    ? jobs.reduce((sum, job) => sum + Number(job.turn_count ?? 0), 0) / total
    : 0;
  const insights: ProductInsight[] = [];

  if (ambiguous.length) {
    const phrases = topPhrases(ambiguous);
    insights.push({
      id: 'asr-and-semantic-normalization',
      area: '语音识别与语义校正',
      severity: ambiguous.length / total >= 0.1 ? 'HIGH' : 'MEDIUM',
      confidence: 'HIGH',
      title: '优先处理无法落到明确意图的语音输入',
      finding: `${ambiguous.length} 条任务被标记为“未识别”，占本次样本 ${percentage(ambiguous.length, total)}。`,
      evidence: [
        `AMBIGUOUS_COMMAND：${ambiguous.length} / ${total || 0} 条`,
        ...phrases.map((phrase) => `高频原始表达：「${phrase.text}」出现 ${phrase.count} 次`),
      ],
      recommendation:
        '在意图执行前增加“音近词 + 上下文”的候选纠错层；先保留原始转写，再把校正结果和置信度展示给用户确认。不要只靠精确唤醒词或精确食材名称匹配。',
      acceptance_criteria: [
        '同类高频表达进入候选纠错后，必须可追溯到原始转写与校正结果。',
        '未达置信阈值时仅询问一次澄清问题，不创建或修改任何提醒、库存记录。',
        '下一轮样本中 AMBIGUOUS_COMMAND 占比相对下降，并保留按表达聚类的监测。',
      ],
    });
  }

  if (longTurns.length || averageTurns >= 3) {
    insights.push({
      id: 'dialogue-state-and-confirmation',
      area: '连续对话与确认状态',
      severity: longTurns.length / Math.max(total, 1) >= 0.15 ? 'HIGH' : 'MEDIUM',
      confidence: 'HIGH',
      title: '减少多轮澄清与重复回复',
      finding: `平均每项任务 ${averageTurns.toFixed(1)} 轮；${longTurns.length} 条任务达到 4 轮或以上。`,
      evidence: [
        `平均轮次：${averageTurns.toFixed(1)}`,
        `长对话（≥4 轮）：${longTurns.length} / ${total || 0} 条`,
      ],
      recommendation:
        '把进行中的“待确认意图”作为单一会话状态保存：补充时间、数量、对象时只更新缺失槽位；用户说“对 / 不对 / 改成”时优先作用于该状态，而不是重新解析成新的库存任务。',
      acceptance_criteria: [
        '同一会话只允许一个待确认任务，打开浮窗或切换页面不能新建并行任务。',
        '确认、否认和修改均能引用最近一次待确认对象、时间、数量。',
        '重复播报、重复提醒和无效澄清在回归对话中不再出现。',
      ],
    });
  }

  if (failed.length) {
    const errorCodes = Array.from(
      countBy(failed.map((job) => job.error_code || 'UNKNOWN')).entries(),
    )
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([code, count]) => `${code}：${count} 条`);
    insights.push({
      id: 'task-execution-reliability',
      area: '任务执行可靠性',
      severity: failed.length / total >= 0.08 ? 'HIGH' : 'MEDIUM',
      confidence: 'HIGH',
      title: '为失败任务提供可恢复路径',
      finding: `${failed.length} 条任务执行失败，占本次样本 ${percentage(failed.length, total)}。`,
      evidence: [`FAILED：${failed.length} / ${total || 0} 条`, ...errorCodes],
      recommendation:
        '把失败区分为识别失败、参数缺失、权限/网络失败和领域规则拒绝；前两类保留会话上下文并给出下一句可操作提示，后两类提供重试与明确状态，而不是泛化回复。',
      acceptance_criteria: [
        '后台可按失败类型、意图和版本查看趋势。',
        '前端对失败显示“未执行”的明确状态，绝不暗示库存或提醒已更新。',
        '每一种错误码至少有一条可回归的示例对话。',
      ],
    });
  }

  if (missingTranscript.length) {
    insights.push({
      id: 'observability-and-privacy',
      area: '可观测性与隐私',
      severity: 'LOW',
      confidence: 'MEDIUM',
      title: '补齐语音链路的最小可观测性',
      finding: `${missingTranscript.length} 条任务没有可用原始转写，难以定位是收音、识别还是意图解析环节的问题。`,
      evidence: [`缺少 transcript_raw：${missingTranscript.length} / ${total || 0} 条`],
      recommendation:
        '记录脱敏后的转写可用性、ASR 置信度、唤醒命中、意图候选和最终执行结果；管理后台默认仅展示必要片段，并设定日志保留期限。',
      acceptance_criteria: [
        '每条失败任务能定位到“收音 / ASR / 语义 / 执行”其中一层。',
        '分析页明确标注数据范围、生成时间和局限，不展示不必要的个人信息。',
      ],
    });
  }

  const headline = !total
    ? '暂无可分析的对话样本'
    : insights.length
      ? `本轮发现 ${insights.length} 个可执行的产品优化方向`
      : '当前样本未出现明显的高风险对话问题';

  return {
    summary: {
      headline,
      detail: total
        ? '建议按影响等级验证：先处理识别与会话状态，再观察失败率和完成轮次的变化。'
        : '请先积累真实对话后再进行复盘；本页不会凭空生成结论。',
    },
    metrics: [
      { label: '分析任务', value: String(total), description: '当前筛选范围内的语音任务数' },
      {
        label: '未识别',
        value: percentage(ambiguous.length, total),
        description: 'error_code 为 AMBIGUOUS_COMMAND 的占比',
      },
      {
        label: '执行失败',
        value: percentage(failed.length, total),
        description: '状态为 FAILED 的占比',
      },
      {
        label: '平均轮次',
        value: averageTurns.toFixed(1),
        description: '每项语音任务记录的对话轮次',
      },
    ],
    insights,
    limitations: [
      '这是对已记录对话事件的证据分析，不等同于用户真实意图或健康建议。',
      '建议需要产品负责人结合原始会话与用户反馈确认后再进入开发排期。',
      '分析只读，不会自动创建提醒、修改库存或改变任何用户数据。',
    ],
  };
}
