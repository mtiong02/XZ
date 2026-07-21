# Skill: XZ Feature Builder

## Purpose

以最小、可测试、可回滚的方式实现一个 XZ 功能。

## Workflow

1. 读取 AGENTS.md、PD、相关架构和 API Contract。
2. 用 5-10 行重述需求、验收标准和非目标。
3. 搜索现有代码，优先复用现有模式。
4. 设计最小 vertical slice：Contract -> Domain -> Application -> Adapter -> UI。
5. 先写或更新测试。
6. 实现，不做无关重构。
7. 运行 lint、typecheck、unit、integration、build。
8. 输出变更清单和已知限制。

## Coding Rules

- 写操作必须是 Command；
- Idempotency 必须明确；
- UI 不包含业务不变量；
- Provider 使用 Adapter；
- 外部输入使用 Schema；
- 错误不可静默；
- 新抽象需要两个真实用例；
- 所有库存变化有 Transaction。

## Completion Report

```text
Implemented behavior
Files changed
Tests added
Commands run and results
API/DB/Event changes
Security/privacy impact
Known limitations
ADR/migration required
```
