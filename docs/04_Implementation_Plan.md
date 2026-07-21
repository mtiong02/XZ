# XZ MVP 实施计划

## 1. 实施目标

在 8 周内交付可供 20-30 户种子家庭测试的软件 MVP，完成数字冰箱、语音库存操作、多端实时同步、临期提醒和可审计流水，同时保留未来硬件、营养、健康和 AI Agent 接口。

## 2. 推荐仓库结构

```text
xz-platform/
├── AGENTS.md
├── apps/
│   ├── web/                 # 响应式 PWA
│   ├── api/                 # 模块化单体 API
│   └── worker/              # Outbox、提醒、异步任务
├── packages/
│   ├── contracts/           # OpenAPI/JSON Schema/共享 DTO
│   ├── ui/                  # 共享 UI 组件
│   ├── config/              # lint、tsconfig、env schema
│   └── test-fixtures/       # 语音、命令、数据测试样本
├── docs/
├── skills/
├── prompts/
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── policies/            # RLS
└── scripts/
```

不要在第一版创建大量共享 packages。只有至少两个 app 真正共享且边界稳定时才提取。

## 3. 开发环境

### 3.1 必要工具

- Node.js 稳定版本，仓库固定版本；
- pnpm workspace；
- PostgreSQL/Supabase 本地环境；
- ffmpeg；
- Docker 可选，用于一致开发环境；
- Git hooks 只做快速检查，不运行完整 E2E。

### 3.2 环境

- local：本地数据库和测试 Provider；
- test：自动化测试；
- staging：真实外部 Provider 的低额度环境；
- production：独立项目、密钥、数据库和存储。

严禁多个环境共享数据库或存储桶。

## 4. Sprint 0：基线与架构护栏（第 1 周）

### 目标

确认已有代码真实状态，建立可持续开发基线。

### 任务

- 审计现有 Flutter/Supabase 或其他代码；
- 决定复用、迁移或停止的模块；
- 初始化 monorepo；
- 配置 TypeScript strict、lint、format、test；
- 配置环境变量 Schema；
- 建立 CI；
- 建立 Supabase/PostgreSQL migration 流程；
- 建立基础 OpenAPI；
- 放入 AGENTS.md、Skills、Prompts；
- 创建第一批 ADR。

### 交付

- 可一键启动的本地环境；
- 空壳 Web、API、Worker 可运行；
- CI 完成 lint、typecheck、unit、build；
- 架构和数据差异报告。

### 退出标准

- 新成员按 README 在 30 分钟内启动；
- 不手工改数据库；
- 所有密钥仅存在 secret store 或本地 env；
- staging 可部署。

## 5. Sprint 1：家庭与数字冰箱基础（第 2 周）

### 功能

- Supabase Auth 或等价认证；
- Household、Member、Role；
- 默认 Refrigerator 和 Zones；
- Food Catalog 基础；
- Inventory Lot 与 Transaction 模型；
- 手动添加、使用、丢弃和修正；
- RLS 和 API 权限。

### 测试

- 家庭越权；
- 数量不能为负；
- FEFO；
- 幂等；
- 交易回滚；
- 并发扣减。

### 退出标准

- 手动闭环完整；
- 核心领域测试覆盖关键不变量；
- 一个家庭不能访问另一个家庭的数据。

## 6. Sprint 2：响应式产品界面（第 3 周）

### 功能

- 手机、iPad、桌面布局；
- 数字冰箱首页；
- 分区、食材卡片、临期状态；
- 食材详情和批次；
- 活动时间线；
- 快速手动操作；
- 空状态、加载状态、错误状态。

### 退出标准

- 三类屏幕主流程通过；
- 用户 10 秒内找到目标食材；
- 所有写操作显示确认和结果。

## 7. Sprint 3：语音输入与理解（第 4 周）

### 功能

- MediaRecorder；
- 音频上传；
- 媒体类型和时长验证；
- ffmpeg 转 16kHz mono；
- ASR Adapter；
- Transcript Normalizer；
- Intent Parser；
- Food Alias 和 Unit Mapping；
- JSON Schema；
- 确认卡片；
- 语音任务审计与自动清理。

### 支持命令

- ADD_INVENTORY
- CONSUME_INVENTORY
- DISCARD_INVENTORY
- QUERY_INVENTORY
- QUERY_EXPIRING
- CORRECT_INVENTORY
- REVERSE_TRANSACTION

### 退出标准

- 单食材意图准确率 >= 95%；
- 食材实体 >= 90%；
- 数量 >= 90%；
- 写操作无确认不执行；
- 原始音频默认 24 小时清理。

## 8. Sprint 4：实时同步与异步事件（第 5 周）

### 功能

- Household Realtime Channel；
- Inventory revision；
- Outbox Table；
- Worker 轮询和幂等消费；
- 多端刷新；
- Reconnect 后拉取完整 snapshot；
- 提醒任务基础。

### 退出标准

- P95 多端同步 <= 1 秒；
- 断线重连数据一致；
- Outbox 重试可见；
- 重复事件不重复处理。

## 9. Sprint 5：临期提醒与基础洞察（第 6 周）

### 功能

- Expiry Status 计算；
- 首页临期优先级；
- 站内提醒；
- 可选 Web Push；
- 本周使用、丢弃和处理率；
- 基础“优先使用”建议，使用确定性排序。

### 原则

- 推荐只基于真实库存；
- LLM 可解释推荐，不决定库存事实；
- 不生成医学健康结论。

## 10. Sprint 6：稳定性、安全与种子测试（第 7 周）

### 功能

- 管理后台最小版；
- 错误追踪；
- 指标仪表板；
- 数据导出与删除入口；
- 隐私说明；
- 语音反馈与错误标记；
- 20-30 户种子用户 onboarding。

### 安全测试

- IDOR；
- RLS；
- 重放；
- 恶意音频；
- Prompt Injection；
- 敏感日志；
- 速率限制。

## 11. Sprint 7：试点复盘与 Stage Gate（第 8 周）

### 输出

- 留存与使用数据；
- 语音错误分类；
- 手动 vs 语音使用率；
- 临期提醒行动率；
- 用户访谈；
- MVP Go/No-Go；
- Hardware Pilot PRD；
- Meal & Intake 需求验证计划。

### 进入硬件样机的门槛

满足至少一个：

- 语音/手动每户每周有效操作 >= 5；
- 7 日留存 >= 35%；
- 用户明确认为“不打开手机”是主要未满足需求；
- 语音入口相对手动明显提升操作频次。

硬件是否量产，必须在后续 A/B 测试证明增益后决定。

## 12. CI/CD 流水线

### Pull Request

```text
install
-> lint
-> typecheck
-> unit tests
-> contract tests
-> database migration check
-> build
-> lightweight security scan
```

### Main

```text
PR gates
-> deploy staging
-> integration tests
-> E2E smoke
-> manual approval
-> production migration
-> production deploy
-> smoke test
-> monitor
```

### 失败策略

- Migration 失败：停止部署；
- Smoke 失败：自动回滚应用版本；
- 数据 migration 不可自动回滚时，使用 forward fix，并提前演练；
- 外部 AI Provider 故障不阻止手动库存功能。

## 13. 分支和提交

- 主干开发或短分支；
- 分支生命周期尽量小于 2 天；
- 一个 PR 解决一个明确问题；
- 不混合功能、重构和依赖升级；
- Commit 使用语义前缀：feat、fix、refactor、test、docs、chore、db；
- PR 必须说明数据库、API、事件和隐私影响。

## 14. Definition of Done

- 产品验收标准通过；
- 失败路径有测试；
- 无直接跨模块写表；
- 新 API 有 OpenAPI；
- 新事件有 Schema；
- 新 migration 有前向、兼容和回滚说明；
- lint、typecheck、tests、build 通过；
- 日志无敏感内容；
- 用户文案准确，不夸大健康能力；
- 文档和 ADR 已更新。

## 15. 风险登记

| 风险                | 概率 | 影响 | 缓解                                     |
| ------------------- | ---- | ---- | ---------------------------------------- |
| 用户不持续维护库存  | 高   | 高   | 优先测试操作频次和留存，减少录入步骤。   |
| 语音数字/单位错误   | 中   | 高   | 关键字段最小置信度、确认卡片、语料回归。 |
| 供应商锁定          | 中   | 中   | Adapter、Contract Test、可替换配置。     |
| 重复扣减            | 中   | 高   | Idempotency、数据库约束、并发测试。      |
| 多端数据漂移        | 中   | 高   | authoritative snapshot + revision。      |
| 健康功能过度承诺    | 中   | 高   | 分层事实、证据和免责声明。               |
| 过早硬件投入        | 高   | 高   | 软件 Stage Gate 后只做 5-10 台样机。     |
| AI 编码造成架构漂移 | 高   | 中   | AGENTS.md、Skills、ADR、CI Guardrails。  |

## 16. 后续实施包

Software MVP 通过后，再创建：

1. Hardware Pilot Implementation Plan；
2. Device Protocol Contract；
3. Meal & Intake PD；
4. Nutrition Data Source Evaluation；
5. Health Compliance & Safety Review；
6. AI Agent Evaluation Plan。
