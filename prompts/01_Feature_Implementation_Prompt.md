# Feature Implementation Prompt

请实现以下 XZ 功能：

`{{FEATURE_REQUEST}}`

先读取 AGENTS.md、PD、架构、API Contract，以及 `skills/xz-feature-builder-SKILL.md`。

输出顺序：

1. 需求重述：目标、验收标准、非目标。
2. 当前代码定位：相关模块、文件、可复用能力。
3. 最小实施计划：Contract、Domain、Application、Adapter/UI、测试。
4. 架构检查：数据 owner、幂等、事务、权限、事件、隐私。
5. 实施代码。
6. 运行并报告 lint、typecheck、unit、integration、build。
7. 汇总：changed files、行为变化、迁移/API/事件、已知限制。

约束：不做无关重构；不直接跨模块写表；LLM 不直接写库；库存使用不等于个人摄入；没有必要不新增依赖或基础设施。
