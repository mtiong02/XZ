# xz-platform

XZ（鲜知）——硬件就绪、健康扩展就绪的 AI 数字冰箱与家庭饮食数据平台。当前阶段：纯软件 MVP。

工程基线与规则见 `AGENTS.md` 与 `docs/`（阅读顺序见 `docs/README` 部分或文档包 README）。

## 仓库结构

```text
xz-platform/
├── AGENTS.md            # AI Coding Agent 长期系统规则（先读这个）
├── apps/
│   ├── web/             # 响应式 PWA（Next.js）
│   ├── api/             # 模块化单体 API（NestJS）
│   ├── speech/          # Sherpa KWS 唤醒词 + MiniMax Realtime 语音代理
│   └── worker/          # Outbox 轮询、提醒等异步任务
├── packages/
│   └── contracts/       # 共享契约：Command Envelope、Channel 等
├── docs/                # PD、架构、API 契约、实施计划、测试、ADR、编码规范
├── skills/              # 任务型工程 Skills
├── prompts/             # AI 编码提示词模板
├── templates/           # ADR / Feature Spec / PR 模板
├── supabase/            # Supabase 本地栈配置与 migrations（CLI 约定目录）
└── scripts/
```

注：`docs/04_Implementation_Plan.md` 中建议的 `database/migrations` 由 Supabase CLI 的
`supabase/migrations` 承担（工具约定优先）；RLS 策略同样写在 migration 中。

## 快速开始（目标：30 分钟内跑起来）

前置：Node 22（见 `.nvmrc`）、pnpm 10、Docker Desktop、Supabase CLI。

```bash
# 1. 安装依赖
pnpm install

# 2. 启动本地 Supabase（PostgreSQL + Auth + Realtime + Storage）
supabase start          # 首次会拉取镜像，输出本地 URL 和 keys

# 3. 配置环境变量
cp .env.example .env    # 用 supabase start 输出的 keys 替换占位值

# 4. 质量门（与 CI 相同）
pnpm verify             # lint + typecheck + test + build

# 5. 首次下载本地量化语音模型（ASR + TTS）
pnpm --filter @xz/speech setup:model

# 6. 启动应用
pnpm --filter @xz/api dev      # API: http://localhost:3001/api/v1/health
pnpm --filter @xz/web dev      # Web: http://localhost:3000
pnpm --filter @xz/worker dev   # Worker 心跳
pnpm --filter @xz/speech dev   # 本地语音: http://127.0.0.1:6010/health
```

## 质量门

所有 PR 必须通过（见 `.github/workflows/ci.yml` 与 `docs/05_Test_and_Quality_Gates.md`）：

```text
lint -> typecheck -> unit tests -> build
```

## 硬性规则（摘自 AGENTS.md）

- 所有写操作转成 Command，由 Application Service 执行；
- LLM 只输出结构化候选或建议，不直接写库；
- 模块只写自己拥有的表；
- 库存使用 ≠ 个人摄入；
- 写操作必须支持 idempotency key；
- migration 是唯一的数据库结构变更方式。
