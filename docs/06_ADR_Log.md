# XZ Architecture Decision Records

## ADR-001：采用模块化单体

### Status

Accepted

### Context

团队小、业务边界仍在验证，但系统需要支持 Web、语音和未来硬件。

### Decision

采用一个主要部署单元，内部按领域模块隔离。

### Consequences

部署和事务简单；模块暂不能独立扩缩容，但未来可按真实瓶颈拆分。

---

## ADR-002：库存使用批次模型

### Status

Accepted

### Context

同一种食材可在不同日期购入并有不同到期日。

### Decision

以 Inventory Lot 管理库存，聚合视图只用于展示。

### Consequences

数据和 UI 更复杂，但保质期、FEFO 和浪费统计准确。

---

## ADR-003：所有写操作使用显式 Command

### Status

Accepted

### Context

语音、手动和未来设备都要共用业务逻辑。

### Decision

所有写入口转换成统一 Command Envelope，由 Application Service 执行。

### Consequences

增加命令层，但避免渠道逻辑复制。

---

## ADR-004：LLM 不直接修改领域数据

### Status

Accepted

### Context

LLM 输出不确定，库存和健康数据需要可审计。

### Decision

LLM 只生成候选命令、解释或 Proposal；正式写入由规则验证和用户确认触发。

### Consequences

交互增加确认步骤，但显著降低错误和安全风险。

---

## ADR-005：MVP 采用 PWA

### Status

Accepted

### Context

需要快速覆盖手机、iPad 和电脑，不依赖应用商店。

### Decision

使用响应式 PWA 作为当前客户端。

### Consequences

上线快、跨端统一；后台能力和原生通知受浏览器限制，未来可增加原生壳。

---

## ADR-006：当前无硬件，但预留 Device Adapter

### Status

Accepted

### Context

最终产品包含吸附在冰箱外部的 AI 玩偶冰箱贴。

### Decision

当前实现移动语音和手动 Adapter；定义 device_id、source channel、device contract，但不部署 MQTT/OTA。

### Consequences

当前增加少量字段与接口，未来硬件接入无需重写领域核心。

---

## ADR-007：按键/显式录音优先于全天监听

### Status

Accepted

### Context

全天监听增加隐私、功耗、误触发和实现复杂度。

### Decision

当前 PWA 使用用户主动录音；未来样机也先采用按键或明确唤醒。

### Consequences

不完全 Zero-UI，但可控且适合验证。

---

## ADR-008：ASR 与 LLM 通过 Provider Adapter

### Status

Accepted

### Context

成本、区域、准确率和隐私要求可能变化。

### Decision

业务代码只依赖内部 SpeechRecognitionProvider 与 StructuredAIProvider 接口。

### Consequences

增加适配层和 contract tests，降低供应商锁定。

---

## ADR-009：区分库存使用和个人摄入

### Status

Accepted

### Context

食材离开冰箱不代表某个人实际吃了。

### Decision

Inventory Consumption、Meal Preparation、Personal Intake 分离建模。

### Consequences

未来记录步骤更复杂，但卡路里和健康分析可解释。

---

## ADR-010：营养与健康独立模块

### Status

Accepted

### Context

未来要接入营养、体检指标、健康目标和建议。

### Decision

Food Knowledge、Meal & Intake、Health Profile 独立，由稳定 ID 和事件连接。

### Consequences

当前需要定义契约，但不会污染库存核心。

---

## ADR-011：采用领域事件与 Transactional Outbox

### Status

Accepted

### Context

提醒、实时同步、分析和未来健康计算要响应同一业务变化。

### Decision

业务事务同时写 outbox，由 Worker 异步处理。

### Consequences

比同步调用更可靠；增加 Worker、重试和事件治理，但无需 Kafka。

---

## ADR-012：核心库存强一致，派生功能最终一致

### Status

Accepted

### Context

库存不能出现事务不一致，但提醒和统计可延迟。

### Decision

库存批次与流水同事务；Realtime、提醒、分析异步。

### Consequences

核心正确性高，用户可能短暂看到派生信息延迟。

---

## ADR-013：AI Agent 只能调用受控 Tools

### Status

Accepted

### Context

未来 Agent 要读取库存、摄入和健康信息并生成建议。

### Decision

Agent 无数据库凭证，只使用 Tool Registry；写操作生成 Proposal。

### Consequences

需要维护 Tool Schema，但安全、可测和可替换。

---

## ADR-014：数据分为确认事实、系统计算和 AI 推断

### Status

Accepted

### Context

健康建议必须说明可信度和依据。

### Decision

三类数据分开存储，AI Insight 保存 evidence、confidence、model version 和 limitation。

### Consequences

数据模型增加元数据，但避免模型推断伪装成事实。

---

## ADR-015：数据库迁移采用 Expand-Migrate-Contract

### Status

Accepted

### Context

未来表结构和 API 会持续演进，直接破坏变更风险高。

### Decision

先添加兼容结构，再回填和切流，最后删除旧结构。

### Consequences

迁移周期更长，但可安全发布和回滚应用。
