# Integration smoke scripts

对真实本地 Supabase + API 验证核心不变量（docs/05）。单元测试见各 app 的 `*.spec.ts` / `*.test.ts`。

## 前提

```bash
supabase start                       # 本地 PostgreSQL + Auth + Realtime
pnpm --filter @xz/api build          # 构建 API
pnpm --filter @xz/worker build       # 构建 Worker（Sprint 4 需要）
```

## 运行

需要注入本地密钥（从 `supabase status` 读取）：

```bash
KEYS=$(supabase status -o json)
export SUPABASE_SERVICE_ROLE_KEY=$(echo "$KEYS" | python3 -c "import json,sys;print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")
export SUPABASE_ANON_KEY=$(echo "$KEYS" | python3 -c "import json,sys;print(json.load(sys.stdin)['ANON_KEY'])")

node apps/api/dist/main.js &         # 启动 API

node scripts/smoke-sprint1.mjs       # 库存命令：FEFO、幂等、修正、撤销、越权
node scripts/smoke-sprint3.mjs       # 语音解析、确认执行、注入防护
node scripts/smoke-sprint4.mjs       # Outbox 排空 + 实时广播（会临时拉起 worker）
node scripts/smoke-sprint5.mjs       # 临期状态 + 本周统计
node scripts/smoke-e2e.mjs           # 端到端主旅程 + 安全（IDOR/限流/导出/删除）
```

每个脚本以退出码 0/1 表示全部通过/存在失败，逐项打印 PASS/FAIL。

## 覆盖矩阵

| 脚本    | docs 依据                  | 关键校验                                                                  |
| ------- | -------------------------- | ------------------------------------------------------------------------- |
| sprint1 | Sprint 1 退出标准          | FEFO 跨批次、幂等不重复扣减、库存不足 409、修正前后值、撤销恢复、家庭隔离 |
| sprint3 | Sprint 3 退出标准          | 中文数字/量词解析、写操作需确认、注入文本不产生破坏命令、语音任务幂等     |
| sprint4 | Sprint 4 退出标准          | outbox processed 标记、订阅者 1s 内收到广播、广播不含库存明细             |
| sprint5 | Sprint 5 退出标准          | EXPIRING/EXPIRED 状态、本周用量/丢弃/处理率                               |
| e2e     | Sprint 6 / docs/05 §2.5 §5 | 主旅程闭环、IDOR、未认证、限流 429、导出无音频、Owner-only 删除           |
