# Skill: XZ Architecture Guardian

## Purpose

在实施功能或重构前，检查变更是否违反 XZ 模块边界、数据所有权和演进策略。

## Inputs

- 用户需求或 issue
- 相关代码
- `docs/02_System_Architecture_Design.md`
- `docs/06_ADR_Log.md`

## Workflow

1. 将需求映射到一个主要 bounded context。
2. 列出需要读取和写入的数据。
3. 确认每张表的 owner module。
4. 检查是否可以通过现有 Application API/Domain Event 完成。
5. 检查是否引入新基础设施、跨模块写表或直接 AI 写库。
6. 给出最小方案与至少一个替代方案。
7. 明确获得什么、放弃什么。
8. 若改变边界、数据所有权或部署拓扑，起草 ADR。

## Hard Stops

- 把库存使用当成个人摄入；
- LLM 直接修改库存或健康数据；
- 无证据引入微服务、Kafka、Redis 等基础设施；
- 一个模块直接写另一个模块的表；
- 无迁移策略的破坏性 Schema 变更。

## Output

```text
Context
Primary module
Affected modules
Data ownership
Proposed design
Alternative
Trade-offs
Risks
ADR required: yes/no
```
