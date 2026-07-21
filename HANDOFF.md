# XZ（鲜知）工程交接文档

> 目的：让新同事在 **30 分钟内**把项目跑起来，并清楚知道代码在哪、怎么改、下一步做什么。
> 配套阅读：`PROGRESS_REPORT.md`（做了什么 + 测试证据）、`docs/`（产品/架构/契约基线）、`AGENTS.md`（AI 与人共用的硬性工程规则）。
> 最后更新：2026-07-21。

---

## 0. 一句话现状

纯软件 MVP（数字冰箱 + 语音库存操作 + 多端实时同步 + 临期/统计 + 安全隐私）**已实现并全部通过验证**，
并额外做了**多轮语音对话**（能复述确认、听"对/不对/改成三盒"）。9 次提交在本地 `main`，
远端仓库 `origin`（`https://github.com/mtiong02/XZ.git`）已配置但**尚未推送**（卡在鉴权，见 §7）。

2026-07-21 晚间增量尚在工作区：MiniMax 实时语音、提醒与每日简报、专业食材分类与储存规则、基础菜谱候选和购物清单均已实现并通过本地测试；本文件后续章节中的提交数和“唯一待办”描述属于旧基线，完成本轮提交后需统一刷新。

### 最新功能模块：菜谱与购物清单

- `GET /households/:id/meal-suggestions`：按真实库存覆盖率和临期食材排序菜谱候选；
- `POST /households/:id/meal-suggestions/:recipeId/add-missing`：把缺料加入购物清单，不修改库存；
- `GET/POST /households/:id/shopping-list`：查询/添加待购物品；
- `POST /households/:id/shopping-list/:itemId/status`：标记已购买或移除；
- 语音支持“购物清单加一包面包”和“查看购物清单有什么”，写入前必须确认；
- 页面入口：`/fridge/meals`；集成回归：`scripts/smoke-meal-planning.mjs`。

---

## 1. 技术栈与选型（已定，勿随意改）

| 层       | 选型                                            | 说明                                                                                                                   |
| -------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 架构     | 模块化单体                                      | 不是微服务（ADR-001）。一个 API 部署单元 + 一个 Worker + 一个 PostgreSQL                                               |
| 后端     | **NestJS**（TS strict）                         | `apps/api`。Controller 只做协议/校验；用例在 Application Service；领域在 domain                                        |
| 前端     | **Next.js 15 响应式 PWA**                       | `apps/web`。App Router，手机/iPad/桌面自适应                                                                           |
| Worker   | Node + pg                                       | `apps/worker`。Outbox 轮询 + 实时广播                                                                                  |
| 数据     | **Supabase 本地栈**（PostgreSQL+Auth+Realtime） | migration 用 Supabase CLI，放 `supabase/migrations`                                                                    |
| 包管理   | **pnpm workspace**                              | Node 22 固定                                                                                                           |
| 语音     | Sherpa-ONNX 专用 KWS 唤醒词 + MiniMax Realtime  | 唤醒后进入连续会话；播报期间关闭 ASR、仅保留 KWS，播放完成恢复聆听；“结束对话”等指令或 30 秒无操作会播报告别并回到待机 |
| 语音形象 | 首页悬浮“小知”3D 人偶 + MiniMax 少女声线        | 进入冰箱页自动申请麦克风并待机；人偶按连接/聆听/理解/播报状态动画反馈                                                  |
| 语音工具 | 库存写入、消耗、丢弃、查询、分类与临期查询      | 句末由浏览器 commit 强制冲刷最终转写，查询读取真实 `InventoryView` 后生成唯一口语答案，不由模型猜测                    |
| 食材分类 | PostgreSQL 邻接表分类树                         | `food_catalog.category_code` 指向具体节点；肉类、水产、调味料等祖先查询用 recursive CTE 覆盖全部后代                   |

**不可动摇的规则（AGENTS.md）**：所有写操作走统一 Command；LLM/解析器只出候选不写库；
模块只写自己的表；库存消耗 ≠ 个人摄入；写操作必须幂等 + 确认；migration 是唯一改库方式。

---

## 2. 本机环境准备（一次性）

> ⚠️ 本机踩过的坑都在这里，照做能少走弯路。

```bash
# Node 22 经 Homebrew 安装且 keg-only —— 每个新终端都要把它加进 PATH
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v   # 应为 v22.x
pnpm -v   # 应为 11.x

# Docker 运行时用 colima（不是 Docker Desktop）
colima start          # Supabase 容器依赖它
docker ps             # 能连上即可

# 其余工具（多数已装）
brew list | grep -E "supabase|ffmpeg|gh"   # supabase CLI / ffmpeg / gh
```

**坑位清单**：

- **没有 `psql`**。要手动跑 SQL 用：`docker exec -i supabase_db_xz-platform psql -U postgres < 文件.sql`
- `supabase/config.toml` 里 `[analytics] enabled=false` —— colima 下 vector 容器挂 docker.sock 会失败，别打开
- `supabase db reset` 会报一条 `pg-delta` DNS 警告，**属正常**，迁移照样全部应用成功

---

## 3. 启动（30 分钟目标）

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd "…/Xtend XZ Gemini/xz-platform"

# 1) 依赖
pnpm install

# 2) 本地数据库（首次会拉镜像）
supabase start
supabase db reset          # 应用全部 migration + seed（食材目录与分类树）

# 3) 取本地密钥并注入环境（API 鉴权 + 冒烟脚本都要）
KEYS=$(supabase status -o json)
export SUPABASE_ANON_KEY=$(echo "$KEYS" | python3 -c "import json,sys;print(json.load(sys.stdin)['ANON_KEY'])")
export SUPABASE_SERVICE_ROLE_KEY=$(echo "$KEYS" | python3 -c "import json,sys;print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")

# 4) 首次准备本地语音模型
pnpm --filter @xz/speech setup:model

# 5) 起服务（四个进程）
pnpm --filter @xz/api dev       # http://localhost:3001/api/v1/health
pnpm --filter @xz/web dev       # http://localhost:3000
pnpm --filter @xz/worker dev    # 后台 Outbox/实时广播
pnpm --filter @xz/speech dev    # KWS 唤醒 + MiniMax Realtime 代理，http://127.0.0.1:6010/health
```

> API 用 GoTrue introspection（`/auth/v1/user`）校验 token，所以**启动 API 前必须 export `SUPABASE_ANON_KEY`**，否则登录态校验会失败。不要改回用 `jsonwebtoken` 校验 HS256。

**演示账号**（`supabase db reset` 后不存在，需自行注册，或用冒烟脚本里的建号方式）：

- 之前演示用的是 `demo@xz.app / demo-password-123`（reset 后会清空，重新注册即可）。

---

## 4. 质量门与验证（改完必须跑）

```bash
pnpm verify        # = lint + typecheck + test + build，PR 必须绿
```

集成冒烟（对真实 API + Supabase 验证关键不变量，需先 export 两个 key 并起好 API）：

```bash
node scripts/smoke-sprint1.mjs    # 库存：FEFO、幂等、库存不足、修正、撤销、家庭隔离
node scripts/smoke-sprint3.mjs    # 语音解析、确认后执行、注入防护
node scripts/smoke-sprint4.mjs    # Outbox 排空 + 实时广播（临时拉起 worker）
node scripts/smoke-sprint5.mjs    # 临期状态 + 本周统计
node scripts/smoke-dialogue.mjs   # 多轮对话：确认/修正"不是两盒是三盒"/追问/拒绝/食材修正
node scripts/smoke-e2e.mjs        # 端到端主旅程 + 安全（IDOR/限流/导出/Owner删除）
```

每个脚本逐项打 PASS/FAIL，退出码 0/1。详见 `scripts/README.md`。

---

## 5. 代码地图（改东西先看这里）

```
xz-platform/
├── AGENTS.md                      # 先读：AI/人共用硬性规则
├── .codex/skills/xz-voice-inventory-agent/ # 语音库存 Agent 开发与验收 Skill
├── HANDOFF.md / PROGRESS_REPORT.md
├── docs/                          # 01 PD · 02 架构 · 03 API契约 · 04 实施 · 05 测试 · 06 ADR · 07 编码规范 · 08 试点模板 · 09 语音对话与ASR/TTS
├── supabase/migrations/           # 8 个迁移（household→food→inventory→outbox→rls→interaction→cascade_fixups→voice_dialogue）
├── scripts/                       # 6 个集成冒烟 .mjs + README
├── packages/contracts/            # 共享契约：Command Envelope、命令 payload zod schema、Inventory 视图类型
└── apps/
    ├── api/src/modules/
    │   ├── auth/                  # Supabase token 校验 Guard + CurrentUser 装饰器
    │   ├── household/             # 家庭/成员/角色、MembershipService（越权校验入口）
    │   ├── food-knowledge/        # 食材目录、别名、单位、专业分类树与递归分类解析
    │   ├── inventory/             # ⭐核心：命令服务(ADD/CONSUME/DISCARD/CORRECT/REVERSE) + domain(FEFO/Decimal/expiry) + 查询(库存/临期/统计/时间线)
    │   ├── interaction/           # ⭐语音：parser(意图/食材/数量) + dialogue(多轮:reply-interpreter/prompts) + voice.service/controller
    │   ├── privacy/               # 数据导出 + Owner-only 删除
    │   ├── member-wellness/       # 本人健康档案、体重趋势、隐私授权、库存个性化候选
    │   └── health/                # /health 探活
    ├── worker/src/                # outbox-processor + realtime-broadcaster（隐私安全 payload）
    ├── speech/src/                # MiniMax Realtime 安全代理 + 本机 sherpa-onnx ASR/Kokoro TTS
    └── web/src/
        ├── app/                   # login · onboarding · fridge(首页/food/settings/stats/timeline)
        ├── components/            # conversation-modal(⭐语音对话) · action-modal(手动增改用) · ...
        └── lib/                   # api · realtime-voice(MiniMax PCM/VAD) · asr(离线) · tts · voice-api
```

**依赖方向**（不可反向）：UI/Controller → Application Service → Domain → Repository → Infra Adapter。
禁止：Controller/React 直接写 SQL；一个模块写另一个模块的表；LLM 直接写库；Prompt 承载业务规则。

---

## 6. 关键设计点 & 已知坑（改前必读）

1. **统一命令入口** `POST /api/v1/commands`：所有库存写操作在此收敛，幂等键 = `household_id + idempotency_key`（唯一约束）。语音确认执行时幂等键派生自 `voice-{jobId}`，保证一个语音任务最多执行一次。
2. **语音多轮对话**（`interaction/dialogue`）：状态 `AWAITING_CONFIRMATION / AWAITING_CLARIFICATION`。
   - `reply-interpreter.ts` 把用户回复判成 确认/拒绝/修正/不清楚；"不是两盒是三盒"→修正，且取**最后一个**数量(3)。
   - ⚠️ **`reply()` 的 CONFIRM 分支必须返回 `getJob()`**（含 `status=COMPLETED`、`spoken_prompt`、`executed_transaction_id`），**不能**返回裸命令结果——否则前端判不出终态会一直转圈。已修复，改动别退回去。
3. **前端语音**（`components/conversation-modal.tsx` + `lib/asr.ts` + `lib/tts.ts`）：
   - 默认走 `lib/realtime-voice.ts` → 本机 `/realtime` 代理；PCM 先由本机 Paraformer 生成最终文本，再进入确定性工具路由。
   - 库存轮只播报 `VoiceService` 的工具结果；只有解析为普通对话时，前端才以文本请求 MiniMax 推理和流式播音。不要恢复“commit 后立刻让 MiniMax 抢答”的旧路径，否则会出现重复答案和虚假库存操作。
   - MiniMax 密钥只在根目录 `.env`，不能放进任何 `NEXT_PUBLIC_` 变量。运行时规则集中在 `apps/speech/src/assistant-policy.ts`。
   - 普通对话交给在线模型，库存命令仍由确定性 parser/VoiceService 解析并确认后执行；模型不能直接写库。
   - 在线失败自动降级到本机 Paraformer；库存提示使用系统 TTS，Kokoro 仅作后备。
   - 播报期间保留较高 VAD 门槛并允许用户打断；收到服务端 `audio-done` 后还要等浏览器播放队列清空，不能提前恢复普通收音门槛。
4. **实时同步**：Worker 读 outbox → 广播到 Supabase Realtime 频道 `household:{id}`，**payload 只含 revision/event_type，不含库存明细**（隐私）；前端收到后调用已认证 API 重新拉 snapshot。
5. **构建配置**：`apps/web/next.config.mjs` 设了 `eslint.ignoreDuringBuilds:true`——因为仓库用根目录 flat-config ESLint（`pnpm lint`/CI）统一跑，不让 Next 再跑第二套。
6. **删除级联**：`20260721070001_cascade_fixups.sql` 给交易明细/自引用补了 `ON DELETE CASCADE / SET NULL`，家庭删除才能干净级联。
7. **食材分类树**：`food_categories` + `food_category_aliases` 由 Food Knowledge 模块拥有。标准食材挂最具体的 `category_code`，例如 `澳洲龙虾 → LOBSTER → CRUSTACEAN → AQUATIC`，`鲍鱼 → ABALONE → MOLLUSK → AQUATIC`。`GET /api/v1/food-categories` 返回路径和别名；旧 `category` 字段只保留兼容。新增分类按 `.codex/skills/xz-voice-inventory-agent/references/food-taxonomy.md` 操作。
8. **成员健康隐私**：`member-wellness` 只允许登录成员维护自己的档案和体重；Owner 默认也不能读取成人成员的私密数据。只有成员主动开启分享，RLS 才允许同家庭查看。当前推荐只对已录入过敏原做强过滤，不把库存变化当摄入，也不提供医疗结论。

---

## 7. 待办：把代码推到远端（当前唯一未完成项）

远端 `origin = https://github.com/mtiong02/XZ.git` 已配好，仓库为空，本地 9 个提交待推。
**卡在鉴权**：GitHub HTTPS 推送需 Personal Access Token，本机 keychain 无有效凭据。

在**你自己的终端**执行任一方式（token 千万别贴进任何聊天/文档）：

```bash
export PATH="/opt/homebrew/bin:$PATH"
cd "…/Xtend XZ Gemini/xz-platform"

# 方式 A（推荐）：网页授权，全程不手打 token
gh auth login          # GitHub.com → HTTPS → Login with a web browser
git push -u origin main

# 方式 B：新建一个 repo 权限的 token，只在 git 密码提示里粘贴
git push -u origin main
# Username: mtiong02   Password: <粘贴新 token>
```

> 之前对话里误贴过一个 token，**务必已在 github.com/settings/tokens 撤销**。

---

## 8. 下一步工作建议（按优先级）

| 优先级 | 事项                       | 入口/说明                                                                                                 |
| ------ | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| P0     | 推送到远端 + 建 CI         | `.github/workflows/ci.yml` 已就位，push 后自动生效                                                        |
| P1     | 用真实家庭语音集调优 ASR   | 已接 FunASR Streaming Paraformer；用噪声、口音和领域词样本评估热词或句末二次校正                          |
| P1     | staging 环境               | 需云端 Supabase 项目 + 独立密钥（docs/04 §3.2）；严禁多环境共库                                           |
| P1     | 语音评估语料               | docs/05 §3 要求 200+ 普通话/50 英文/50 中英混合等；建回归集守准确率                                       |
| P1     | Web Push / OCR 小票 / 条码 | PD 里的 P1 清单（docs/01 §6.2），MVP 验证后再做                                                           |
| P2     | 未来模块契约落地           | Meal/Intake、Nutrition、Health、AI Agent 目前只有契约（docs/03、docs/02 §13-14），Stage Gate 通过后再实现 |

**范围纪律**：改产品范围先更 PD；改模块边界/数据所有权先加 ADR；改 API/事件 Schema 要版本化；
改库必须有 migration + 回滚说明。不为"未来百万用户"提前复杂化（KISS/YAGNI，docs/07）。

---

## 9. 求助路径

- 不确定某功能做没做/怎么验证 → 看 `PROGRESS_REPORT.md` 的覆盖矩阵
- 不确定架构边界/能不能这么改 → 看 `docs/02`、`docs/06`（ADR）、`AGENTS.md`
- 语音/对话相关 → `docs/09` + `apps/api/src/modules/interaction/` + `scripts/smoke-dialogue.mjs`
- 某条业务规则为什么这样 → `docs/01`（PD §8 业务规则）、对应 ADR
