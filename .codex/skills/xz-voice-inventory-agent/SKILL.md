---
name: xz-voice-inventory-agent
description: Develop, diagnose, or review XZ 鲜知 realtime voice inventory interactions, including MiniMax runtime prompts, wake-word sessions, ASR transcripts, food entities and units, inventory tool routing, food taxonomy, and duplicate-response prevention. Use whenever changing speech, conversation, interaction parser, food-knowledge, or voice-driven inventory query/write behavior in the xz-platform repository.
---

# 鲜知语音库存 Agent

## 目标

让语音模型负责自然语言交流，让确定性应用工具负责库存事实。保持唤醒、识别、工具调用、播报和继续收音组成一条可回归的状态链。

## 开始工作

1. 完整读取仓库 `AGENTS.md`、相关交接文档和当前实现。
2. 读取 `apps/speech/src/assistant-policy.ts`；它是 MiniMax 运行时约束的唯一代码来源。
3. 涉及分类或新食材时读取 [references/food-taxonomy.md](references/food-taxonomy.md)。
4. 先把用户的真实失败对话写成回归用例，再修改实现。

## 不可违反的边界

- 把当前库存、数量、分类和临期状态视为数据库事实。LLM 不得猜测，也不得让用户反过来提供系统已有库存。
- 把查询自动交给 `InventoryQueryService`；把新增、消耗、丢弃交给 Command 流水线并要求确认。LLM、前端和 Speech Adapter 均不得直接写库存表。
- 一轮用户输入只允许一个最终答案。先用本机识别文本完成工具路由；库存轮只播报工具结果，普通对话才请求 MiniMax，禁止让两条回答并行生成。
- 识别文本可以模糊，库存执行必须确定。食材、数量或单位不完整时只追问一个关键问题，禁止擅自补默认值。
- 唤醒必须由 KWS 命中；播报期间的普通环境声不得打断。命中后先简短确认“我在，请说”，播完再开放指令收音。
- 不在 prompt、组件或正则中硬编码食材清单。食材归类写入 Food Knowledge 分类树，分类查询必须包含所有后代节点。
- 不删除原始交易来“修正”库存；使用既有撤销或修正领域流程。

## 语音状态验收

按顺序验证：

- 待机时普通语音不产生回复。
- “小知小知”命中后只播一次“我在，请说”。
- 问候的扬声器回声不进入用户指令。
- 用户停顿后完整提交句尾，不漏最后几个字。
- 库存问题命中本地工具并只播报工具结果。
- “有哪些肉/海鲜/调味料”按分类树递归查询，不混入其他类别。
- “冷冻区/冷藏室/常温区有什么”只返回对应存放区域，不混入其他区域。
- “明天安排了什么/有什么提醒”必须读取已保存的提醒任务；不得由模型猜测日程。
- 写操作缺数量或单位时追问；信息完整后仍需确认。
- “用掉一半”等相对数量必须读取当前库存换算成绝对数量，再让用户确认；不得由模型直接声称已记录。
- 在追问或确认状态中，“不对/取消/结束对话”必须优先退出当前候选，不能继续重复追问。
- 用户明确结束或超时后播报退场语，再返回 KWS 待机。

## 分类扩展流程

1. 在新 migration 中添加或复用分类节点及中文别名。
2. 把标准食材的 `category_code` 指向尽可能具体的叶节点，并添加常见口语别名。
3. 不改写已执行的 migration；同步更新 `supabase/seed.sql`，确保空库重建一致。
4. 为分类别名匹配和祖先节点查询补测试。例如“肉类”命中猪肉和牛肉，“水产”命中澳洲龙虾与鲍鱼。
5. 保留旧 `category` 仅作兼容；新查询使用 `category_code`。

## 修改运行时规则

直接修改 `apps/speech/src/assistant-policy.ts`，不要在 Web、API 和代理中复制多个 prompt。同步检查本 Skill 是否需要更新。Prompt 只能约束表达和模型边界；库存正确性必须由解析器、服务和数据库约束保证。

## 必做验证

至少运行：

- `pnpm --filter @xz/api test`
- `pnpm --filter @xz/speech test`
- `pnpm typecheck`
- `pnpm lint`
- `git diff --check`

存在 migration 时，还要在本地数据库执行并用真实库存验证至少一个祖先分类查询。不要在 Web 开发服务运行时执行会覆盖 `.next` 的生产构建；改用分包类型检查，或先停止开发服务。
