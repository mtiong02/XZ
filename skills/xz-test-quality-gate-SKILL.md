# Skill: XZ Test & Quality Gate

## Purpose

验证变更不会破坏库存正确性、租户隔离、AI 安全和发布质量。

## Workflow

1. 从验收标准提取可测试行为。
2. 标出关键不变量：授权、幂等、非负、事务、确认。
3. 选择最小适合的测试层。
4. 为 Bug 增加回归测试。
5. 运行相关测试和全局质量门。
6. 若测试失败，不用跳过或放宽断言掩盖问题。
7. 输出证据，而不是仅输出结论。

## Mandatory Cases for Inventory Writes

- authorized success；
- unauthorized household；
- duplicate idempotency key；
- insufficient inventory；
- concurrent requests；
- transaction rollback；
- audit/outbox creation。

## Mandatory Cases for AI/Voice

- invalid audio；
- ASR timeout；
- invalid JSON；
- low confidence；
- prompt injection attempt；
- user correction；
- no write before confirmation。

## Output

```text
Acceptance criteria coverage
Tests added/updated
Commands and results
Uncovered risks
Release recommendation: pass/fail
```
