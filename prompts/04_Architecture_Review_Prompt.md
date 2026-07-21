# Architecture Review Prompt

请审查以下设计或代码变更：

`{{CHANGE_OR_DESIGN}}`

依据 XZ 架构文档和 `skills/xz-architecture-guardian-SKILL.md`，按以下结构输出：

- Problem and constraints
- Primary bounded context
- Affected modules and data ownership
- Current proposal
- At least one simpler alternative
- Trade-offs: simplicity, consistency, privacy, reversibility, future hardware/health
- Failure modes
- Security and AI safety
- Migration and rollout
- Decision recommendation
- ADR required: yes/no

重点挑战：是否跨模块写表、是否把 AI 推断当事实、是否把库存使用当摄入、是否为未来过度设计、外部供应商是否可替换。
