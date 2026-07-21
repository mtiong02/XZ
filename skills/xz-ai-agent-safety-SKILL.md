# Skill: XZ AI Agent Safety

## Purpose

设计或审查 XZ 的 LLM、Prompt、Tool 和健康建议功能，保证事实边界、权限和可解释性。

## Workflow

1. 确定任务是读取、计算、建议还是写入。
2. 列出 Agent 可用 Tools 和每个 Tool 的最小权限。
3. 定义 JSON Schema、错误和超时。
4. 区分用户确认事实、系统计算和 AI 推断。
5. 为写操作创建 Proposal + Confirmation，不允许直接执行。
6. 添加 evidence refs、data coverage、model/prompt version 和 limitations。
7. 创建固定评估集和 Prompt Injection 测试。
8. 记录成本、延迟和失败降级。

## Hard Stops

- Agent 获得数据库通用写权限；
- 将库存减少直接计算为某人的卡路里；
- 无数据覆盖率却给出精确健康结论；
- 输出医学诊断或治疗建议；
- Prompt 能提升 Tool 权限；
- 日志保存完整健康数据或原始音频。

## Output

```text
Agent objective
Allowed tools
Forbidden actions
Input/output schema
Evidence and confidence model
Confirmation path
Evaluation cases
Fallback behavior
```
