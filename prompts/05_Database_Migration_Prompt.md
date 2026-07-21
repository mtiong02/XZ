# Database Migration Prompt

请为以下数据变更设计并实现 migration：

`{{DATABASE_CHANGE}}`

读取 API/Data Contract、ADR 和 `skills/xz-database-migration-SKILL.md`。

必须输出：

1. 当前与目标 Schema。
2. 数据量和锁风险假设。
3. Expand-Migrate-Contract 步骤。
4. Migration 文件和 backfill。
5. 新旧应用兼容顺序。
6. 验证 SQL。
7. 回滚或 forward-fix。
8. 空库、上一版本快照和脏数据测试结果。

禁止直接删除字段、手工改生产库或在单次部署中执行不可控的大表重写。
