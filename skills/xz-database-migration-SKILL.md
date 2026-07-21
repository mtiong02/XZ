# Skill: XZ Database Migration

## Purpose

安全实施 PostgreSQL Schema 或数据迁移，避免数据丢失、长锁和版本不兼容。

## Workflow

1. 说明现状、目标和数据量假设。
2. 判断是否可使用 Expand-Migrate-Contract。
3. 创建 migration，不手工改库。
4. 添加约束前先检测脏数据。
5. 大量 backfill 使用可重入批处理和进度记录。
6. 新旧应用必须在兼容窗口内同时工作。
7. 在空库和上一版本快照测试。
8. 写 rollback 或 forward-fix 计划。
9. 更新 API/Data Contract 与 ADR（如需要）。

## Hard Rules

- 不在单次 migration 中对大表做不可控全表重写；
- 不直接删除生产字段；
- 不改变单位含义而不迁移数据；
- 多租户表必须有 household scope 和索引；
- 新唯一约束先清理重复数据；
- 健康数据迁移需要额外隐私检查。

## Output

```text
Migration plan
Compatibility plan
SQL/migration files
Backfill strategy
Validation queries
Rollback/forward-fix
Deployment order
```
