# XZ AI 编码与简洁代码规范

## 1. 目的

AI Coding Agent 的优势是速度，主要风险是：范围膨胀、抽象过度、重复实现、架构边界漂移、测试缺失和看似合理但不可维护的代码。本规范把 AI 编码变成受控工程流程。

## 2. 简洁代码原则

### 2.1 KISS

选择团队当前能理解和维护的最简单实现。没有实际需求，不引入分布式系统、通用规则引擎或复杂框架。

### 2.2 YAGNI

“未来可能需要”只允许形成契约、字段或 ADR，不允许提前完成整套功能。

### 2.3 Explicit over Magic

- 显式命令优于隐式 ORM Hook；
- 显式依赖优于全局 Service Locator；
- 显式错误优于返回 null；
- 显式单位优于裸数字；
- 显式事务优于多个独立写操作。

### 2.4 Domain Language

代码使用业务语言：InventoryLot、ConsumeInventory、PersonalIntake，而不是模糊的 DataManager、ProcessItem、Helper。

### 2.5 One Reason to Change

模块、类和函数围绕一个业务职责。不要按技术类型创建巨大的 `utils`、`services`、`helpers`。

## 3. 架构规则

1. Controller 只做协议适配、认证上下文和输入校验。
2. Application Service 编排用例和事务。
3. Domain 保持纯净，表达不变量。
4. Repository 只负责持久化，不包含 UI 或 AI 逻辑。
5. 外部 Provider 通过 Adapter。
6. React Component 不包含库存业务规则。
7. Prompt 不承担数据库规则和权限规则。
8. 一个模块不得直接更新另一个模块拥有的表。
9. 新基础设施必须有 ADR 和替代方案分析。
10. 新抽象至少需要两个真实用例，否则保留局部实现。

## 4. TypeScript 规则

- `strict: true`；
- 禁止无解释的 `any`；
- 外部输入先 unknown，再 Schema parse；
- Domain ID 使用 branded type 或明确类型；
- 业务数量使用 Decimal/String transport，不用浮点直接累计；
- 使用 discriminated union 表达状态；
- Exhaustive switch；
- 不通过类型断言绕过校验；
- 公共函数和契约有明确返回类型；
- 错误使用受控 error code。

### 示例

```ts
type VoiceJobState =
  | { status: 'PROCESSING' }
  | { status: 'AWAITING_CONFIRMATION'; candidate: InventoryCommand }
  | { status: 'COMPLETED'; transactionIds: string[] }
  | { status: 'FAILED'; code: VoiceJobErrorCode };
```

## 5. 函数与模块

- 函数短小到可以一次读懂，但不使用机械行数限制；
- 参数超过 3-4 个时考虑参数对象；
- 不返回多义 tuple；
- 不在同一函数中混合 I/O、解析、业务决策和格式化；
- 不创建万能 BaseService/BaseRepository；
- 共用代码只有稳定且确实重复时提取；
- 文件名和目录名反映业务能力。

## 6. 错误处理

禁止：

```ts
try { ... } catch { return null; }
```

要求：

- 分类为 Validation、Authorization、Conflict、Dependency、Internal；
- 保留 cause，但不向用户泄漏敏感信息；
- 外部 Provider 错误映射到内部错误；
- 重试只用于幂等且短暂的错误；
- 不对业务冲突进行自动重试；
- 所有失败路径有测试和可观察指标。

## 7. 数据库原则

- Migration 是唯一结构变更方式；
- 核心约束尽量同时在 Domain 与 DB 表达；
- 事务范围最小且明确；
- 不使用数据库触发器隐藏跨模块业务；
- 查询避免 N+1；
- 每个多租户查询包含 household scope；
- 表包含 created_at，必要时 updated_at/version；
- 软删除只在确有恢复或审计要求时使用；
- 历史库存通过反向交易，不直接改旧流水。

## 8. API 原则

- API Contract First；
- JSON Schema/OpenAPI 是共享事实；
- 写操作幂等；
- 错误码稳定；
- 分页使用 cursor；
- 不返回数据库内部结构；
- 不让客户端决定权限敏感字段；
- 破坏性变更版本化。

## 9. AI 与语音代码原则

- 原始音频先验证和标准化；
- ASR 结果保留 raw 与 normalized；
- LLM 输出必须 Schema parse；
- 关键字段使用最低置信度原则；
- Prompt 有版本和回归测试；
- AI 不直接写库；
- Prompt Injection 不能改变系统工具权限；
- 生产日志不包含原始音频和完整敏感文本；
- 模型升级必须比较固定评估集。

## 10. 测试原则

- 测试行为，不测试实现细节；
- Domain 测试优先；
- 每个 Bug 先写回归测试；
- Mock 外部边界，不 Mock 领域核心；
- 数据库约束使用真实 PostgreSQL 测试；
- E2E 只覆盖关键旅程；
- 随机或时间依赖可注入 Clock/ID Generator；
- 测试名称描述 Given/When/Then 业务行为。

## 11. AI Agent 实施流程

### Step 1：理解

输出：

- 当前行为；
- 目标行为；
- 影响模块；
- 不明确点；
- 风险和非目标。

### Step 2：计划

计划必须最小化，列出：

- 修改文件；
- 数据库/API/事件影响；
- 测试；
- 是否需要 ADR；
- 回滚方式。

### Step 3：实现

- 先契约和测试；
- 再领域规则；
- 再 Application；
- 再 Adapter/UI；
- 每一步保持可编译。

### Step 4：验证

至少执行：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

涉及数据库、API 或 E2E 时增加对应命令。

### Step 5：交付

报告：

- changed files；
- behavior changes；
- tests and results；
- migration/deployment notes；
- known limitations；
- follow-up only if necessary。

## 12. 禁止模式

- 为一个用例创建通用框架；
- 无需求新增缓存、队列、微服务；
- 将“将来健康”实现成空的复杂服务；
- 直接让 LLM 生成 SQL 并执行；
- 直接把库存消耗写成卡路里摄入；
- 在 UI 中复制后端业务判断；
- 把所有错误 catch 后返回 200；
- 大 PR 同时重构、升级依赖和开发功能；
- 未运行测试却声称完成；
- 删除未知代码而不确认用途；
- 用 TODO 代替安全、事务或权限实现。

## 13. 代码评审检查表

- 需求是否被最小实现？
- 是否改变模块边界？
- 是否出现跨模块写表？
- 是否有隐藏副作用？
- 数量和单位是否明确？
- 幂等、并发和事务是否正确？
- AI 输出是否经过校验和确认？
- 日志是否泄漏敏感数据？
- 测试是否覆盖失败路径？
- 是否可以安全回滚？
- 文档和 ADR 是否同步？
