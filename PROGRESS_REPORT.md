# XZ（鲜知）MVP 进度报告

| 字段     | 内容                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| 报告日期 | 2026-07-21                                                                           |
| 阶段     | 纯软件 MVP + 多轮语音对话                                                            |
| 代码量   | 源码约 7,100 行 TS/TSX（不含测试）                                                   |
| 提交     | 9 次（`2270de1` → `ffa5961`），本地 `main`，远端待推                                 |
| 总体状态 | ✅ Sprint 0–6 全部实现并通过验证；额外完成多轮语音对话；Sprint 7（真人试点）仅出模板 |

配套：`HANDOFF.md`（如何接手继续）、`docs/`（基线文档）。

---

## 1. 总览：做了什么

从一套纯文档的工程包（PD/架构/契约/实施/测试/ADR/编码规范）出发，落地成一个**可运行、经真实验证**的
数字冰箱 MVP，并把语音从"一次性确认"升级到"可对话确认"。

**核心能力**：

- 数字冰箱（家庭/成员、冷藏/冷冻/常温分区、库存批次、FEFO）
- 统一命令：添加 / 使用 / 丢弃 / 修正 / 撤销，全部幂等 + 事务 + 审计
- 语音/文本输入 → 解析 → 确认 → 执行；**多轮对话**（复述确认、听"对/不对/改成三盒"、缺数量追问）
- 多端实时同步（Outbox + Supabase Realtime，1 秒内）
- 临期状态 + 首页优先处理 + 本周统计
- 多租户隔离（API + RLS 双层）、写操作限流、数据导出、Owner-only 删除
- 响应式 PWA（手机/iPad/桌面）

---

## 2. 分 Sprint 完成情况

| Sprint          | 内容                                                                                   | 提交                | 状态                  |
| --------------- | -------------------------------------------------------------------------------------- | ------------------- | --------------------- |
| 0 基线          | pnpm monorepo、TS strict、ESLint 落地 AGENTS.md、CI、Supabase 本地栈                   | `2270de1`           | ✅                    |
| 1 库存核心      | 8 表 + RLS + 种子；领域(Decimal/FEFO/临期/分类错误)；`POST /commands` 5 命令；成员鉴权 | `dbf95b5`           | ✅                    |
| 2 响应式 PWA    | 登录、数字冰箱首页、食材详情、活动时间线、两步确认卡片                                 | `efe7700`           | ✅                    |
| 3 语音输入      | 中文数字归一 + 规则解析(意图/食材/数量) + ASR Adapter + 文本通道 + 确认执行 + 注入防护 | `a4910e3`           | ✅                    |
| 4 实时同步      | Outbox Worker(SKIP LOCKED/退避/死信) + Realtime 广播(隐私 payload) + 前端订阅刷新      | `82c3295`           | ✅                    |
| 5 临期+统计     | 本周使用/丢弃/处理率、临期状态、"消耗≠个人摄入"声明                                    | `3106928`           | ✅                    |
| 6 安全+隐私+E2E | 写限流(429)、数据导出、Owner-only 删除+级联修复、隐私页、端到端安全冒烟                | `e03dd72`           | ✅                    |
| 7 试点复盘      | 真人 20-30 户试点，无法工程自动完成                                                    | —                   | 📋 仅出模板 `docs/08` |
| ➕ 语音对话     | 多轮状态机（确认/修正/追问/拒绝）+ 聊天式 UI + Kokoro TTS                              | `4542d00`,`ffa5961` | ✅                    |

---

## 3. 交付物清单

### 数据库（8 个迁移，`supabase db reset` 全新库验证可全部应用）

`household` → `food_knowledge` → `inventory` → `outbox` → `rls` → `interaction` → `cascade_fixups` → `voice_dialogue`

### API（NestJS，模块 + 主要端点）

| 模块           | 端点                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| auth           | Token 校验 Guard（GoTrue introspection）                                                                                 |
| household      | `POST/GET /households`、`GET/POST /households/:id/members`                                                               |
| food-knowledge | `GET /foods`、`GET /units`                                                                                               |
| inventory      | `POST /commands`、`GET /households/:id/inventory`、`/inventory/expiring`、`/stats`、`/transactions`、`/foods/:id/detail` |
| interaction    | `POST /voice-jobs`、`GET /voice-jobs/:id`、`POST /voice-jobs/:id/{confirm,reply,cancel}`                                 |
| privacy        | `GET /households/:id/export`、`DELETE /households/:id`                                                                   |
| health         | `GET /health`                                                                                                            |

### Web（Next.js，页面）

`login`、`onboarding`、`fridge`（首页/`food/[id]`/`settings`/`stats`/`timeline`）。
核心组件：`conversation-modal`（语音对话）、`action-modal`（手动增改用）。

### Worker

`outbox-processor`（幂等消费/退避/死信）+ `realtime-broadcaster`（隐私安全 payload）。

### 文档

`docs/01–09`（新增 `08` 试点模板、`09` 语音对话与 ASR/TTS 选型）；`AGENTS.md`；6 个 `scripts/smoke-*.mjs`。

---

## 4. 测试与验证证据（非声称，均真实运行通过）

### 单元测试

- API：**43 个**（8 个 spec 文件：命令/FEFO/幂等/解析器/对话回复解析/限流/环境校验/健康）
- Worker：**7 个**（outbox 消费幂等/退避/死信 + 环境）
- Contracts：**4 个**（Command Envelope schema）
- `pnpm verify`（lint+typecheck+test+build）**全绿**

### 集成冒烟（对真实 PostgreSQL + API，全新库上重跑仍全绿）

| 脚本           | 检查数 | 关键点                                                                      |
| -------------- | -----: | --------------------------------------------------------------------------- |
| smoke-sprint1  |     17 | FEFO 跨批次、幂等不重复扣减、库存不足 409、修正前后值、撤销恢复、家庭隔离   |
| smoke-sprint3  |     14 | 中文数字/量词解析、写操作需确认、注入文本不产生破坏命令、语音任务幂等       |
| smoke-sprint4  |      6 | outbox processed 标记、订阅者 1s 内收到广播、广播不含库存明细               |
| smoke-sprint5  |     10 | EXPIRING/EXPIRED 状态、本周用量/丢弃/处理率                                 |
| smoke-dialogue |     19 | 确认流、修正"不是两盒是三盒"、追问、拒绝、食材修正、对话回合记录            |
| smoke-e2e      |     16 | 主旅程闭环、IDOR、未认证、限流 429、导出无音频、Owner-only 删除、日志无泄漏 |

### 浏览器端到端实测（真实 UI）

- 注册→建家庭→手动添加→**语音使用鸡蛋 10→7**→确认→撤销→恢复
- 语音**多轮对话**：加两盒牛奶→"你是说添加2盒牛奶对吗"→**"不是三盒"→"好的改成3盒"**→对→已添加（牛奶 5→7）
- **单位修正**：一盒酸奶→box→bottle 领域拒绝→"一瓶"→改成1瓶→成功入库
- Kokoro TTS 从 CDN 加载成功；日志敏感数据扫描 0 命中
- 手机视口单列自适应

---

## 5. 关键不变量守护情况（业务正确性）

| 不变量              | 守护方式                                        | 验证                          |
| ------------------- | ----------------------------------------------- | ----------------------------- |
| 不重复扣减          | 幂等键唯一约束 + 并发测试                       | smoke-sprint1、e2e            |
| 不产生负库存        | 领域校验 + DB 约束                              | smoke-sprint1                 |
| 不越权              | MembershipService + RLS 双层                    | smoke-sprint1/e2e（IDOR 403） |
| AI 输出不当事实     | 解析器只出候选，写操作必确认                    | smoke-sprint3/dialogue        |
| 库存消耗 ≠ 个人摄入 | 命令分离 + 统计声明                             | smoke-sprint5、UI 声明        |
| 审计链完整          | 每笔交易含操作者/来源/时间；删除走反向交易      | 时间线 UI、smoke-sprint1      |
| 外部故障可降级      | ASR/TTS/Realtime 均 Adapter，失败不阻断手动库存 | 架构 + 兜底实现               |

---

## 6. 已知限制 / 未完成（诚实清单）

1. **未推送远端**：`origin` 已配好、仓库为空、9 提交待推，卡在 GitHub HTTPS 鉴权（需 token/gh 登录，属账号操作，见 `HANDOFF.md §7`）。
2. **真实 ASR 未接**：当前 ASR=浏览器 Web Speech（真机可用）、TTS=Kokoro；服务端/端上真实 ASR（faster-whisper/FunASR/sherpa-onnx）为下一步，接口已抽象（`docs/09`）。
3. **无 staging**：CI 配置就位但需 push 后生效；staging 需云端 Supabase 项目（账号操作）。
4. **限流为单实例内存版**：多实例部署需换共享存储（Redis），已在代码注释标注。
5. **未来模块仅契约**：Meal/Intake、Nutrition、Health、AI Agent 只定义了表与契约，未实现（按 Stage Gate）。
6. **Sprint 7 需真人**：试点复盘/指标采集/Go-No-Go 需真实用户，已出模板 `docs/08`。

---

## 7. 北极星与验收对照（docs/01 §10、docs/05 §8）

MVP 工程侧的"发布准入"多数已满足：P0 功能验收通过、重复扣减/越权/负库存测试全过、
三端主流程可用、原始音频不落库、审计记录可用、隐私文案就位。
**运营侧指标**（留存、语音完成率、每户每周操作数等）需真人试点采集 —— 见 `docs/08` 模板。

---

## 8. 时间线（同一工作会话内完成）

Sprint 0 基线 → Sprint 1–6 逐 Sprint 实现+冒烟 → 浏览器全功能演示 → 语音升级为多轮对话（后端状态机 + 前端 Kokoro/Web Speech UI）→ 配置远端仓库（待鉴权推送）→ 本交接/进度文档。

每一步都遵循：先补测试/冒烟 → 实现最小变更 → 跑 `pnpm verify` + 冒烟 → 通过后提交。
