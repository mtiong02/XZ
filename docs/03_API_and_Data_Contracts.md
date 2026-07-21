# XZ API 与数据契约

## 1. 目标

本文件定义跨前端、后端、未来硬件和 AI Agent 的稳定契约。实现可变化，契约变化必须显式版本化。

## 2. API 规范

- Base Path：`/api/v1`
- Content-Type：`application/json`；音频上传使用 multipart。
- 时间：ISO 8601 UTC。
- ID：不可猜测的字符串 ID。
- 写请求头：`Idempotency-Key` 必填。
- 认证：Bearer token。
- 错误：统一 Problem Details 风格。

### 2.1 错误结构

```json
{
  "type": "https://xz.app/errors/insufficient-inventory",
  "title": "Insufficient inventory",
  "status": 409,
  "code": "INVENTORY_INSUFFICIENT",
  "detail": "Egg has only 1 piece available.",
  "trace_id": "tr_123",
  "fields": []
}
```

## 3. 通用来源模型

```json
{
  "channel": "MOBILE_VOICE",
  "client": "pwa",
  "device_id": null,
  "interaction_id": "int_123"
}
```

Channel：

```text
WEB_MANUAL
MOBILE_MANUAL
TABLET_MANUAL
WEB_VOICE
MOBILE_VOICE
TABLET_VOICE
FRIDGE_MAGNET_VOICE
SYSTEM_REMINDER
IMPORT_OCR
EXTERNAL_INTEGRATION
```

## 4. 核心命令

### 4.1 ADD_INVENTORY

```json
{
  "command_type": "ADD_INVENTORY",
  "schema_version": "1.0",
  "household_id": "hh_1",
  "actor_member_id": "m_1",
  "source": { "channel": "MOBILE_VOICE" },
  "payload": {
    "items": [
      {
        "food_id": "food_egg",
        "display_text": "鸡蛋",
        "quantity": "10",
        "unit": "piece",
        "storage_zone_id": "zone_fridge",
        "expires_at": "2026-08-01T00:00:00Z",
        "expiry_source": "USER_CONFIRMED"
      }
    ]
  }
}
```

### 4.2 CONSUME_INVENTORY

```json
{
  "command_type": "CONSUME_INVENTORY",
  "payload": {
    "items": [
      {
        "food_id": "food_egg",
        "quantity": "2",
        "unit": "piece",
        "allocation": "FEFO"
      }
    ],
    "purpose": "MEAL_PREPARATION"
  }
}
```

`purpose` 不是个人摄入事实，可选值：MEAL_PREPARATION、SHARED、OTHER、UNKNOWN。

### 4.3 DISCARD_INVENTORY

```json
{
  "command_type": "DISCARD_INVENTORY",
  "payload": {
    "items": [{ "food_id": "food_spinach", "quantity": "300", "unit": "g" }],
    "reason": "SPOILED"
  }
}
```

### 4.4 CORRECT_INVENTORY

```json
{
  "command_type": "CORRECT_INVENTORY",
  "payload": {
    "food_id": "food_egg",
    "target_total_quantity": "5",
    "unit": "piece",
    "reason": "PHYSICAL_COUNT"
  }
}
```

### 4.5 REVERSE_TRANSACTION

```json
{
  "command_type": "REVERSE_TRANSACTION",
  "payload": {
    "transaction_id": "txn_123",
    "reason": "USER_UNDO"
  }
}
```

### 4.6 RECORD_PERSONAL_INTAKE（未来）

```json
{
  "command_type": "RECORD_PERSONAL_INTAKE",
  "payload": {
    "member_id": "m_1",
    "consumed_at": "2026-07-21T04:00:00Z",
    "items": [{ "food_id": "food_egg", "quantity": "2", "unit": "piece" }],
    "deduct_inventory": true
  }
}
```

该命令必须由用户明确确认；不能由普通 CONSUME_INVENTORY 自动推导。

## 5. Voice API

### 5.1 创建任务

`POST /api/v1/voice-jobs`

Multipart：

- audio
- household_id
- actor_member_id
- locale
- client_request_id

响应：

```json
{
  "voice_job_id": "vj_1",
  "status": "PROCESSING",
  "created_at": "2026-07-21T03:00:00Z"
}
```

### 5.2 查询任务

`GET /api/v1/voice-jobs/{id}`

```json
{
  "status": "AWAITING_CONFIRMATION",
  "transcript": {
    "raw": "午饭用了两个鸡蛋",
    "normalized": "午饭用了2个鸡蛋"
  },
  "candidate_command": {
    "command_type": "CONSUME_INVENTORY",
    "payload": {
      "items": [{ "food_id": "food_egg", "quantity": "2", "unit": "piece" }]
    }
  },
  "confidence": {
    "audio_quality": 0.91,
    "asr": 0.94,
    "intent": 0.98,
    "food_entity": 0.97,
    "quantity": 0.91,
    "overall": 0.91
  },
  "requires_confirmation": true
}
```

### 5.3 确认

`POST /api/v1/voice-jobs/{id}/confirm`

请求包含用户最终确认的 command payload。服务端不得信任客户端提供的 household_id，必须从原 voice job 和认证上下文验证。

### 5.4 取消

`POST /api/v1/voice-jobs/{id}/cancel`

## 6. Inventory API

- `GET /households/{id}/inventory`
- `GET /households/{id}/inventory/expiring`
- `GET /inventory/lots/{id}`
- `POST /commands`：统一执行命令
- `GET /transactions?household_id=&cursor=`
- `POST /transactions/{id}/reverse`

### 6.1 Inventory View

```json
{
  "household_id": "hh_1",
  "revision": 128,
  "zones": [
    {
      "zone_id": "zone_fridge",
      "name": "冷藏室",
      "items": [
        {
          "food_id": "food_egg",
          "name": "鸡蛋",
          "total_quantity": "14",
          "unit": "piece",
          "earliest_expiry": "2026-07-29T00:00:00Z",
          "expiry_status": "NORMAL",
          "lot_count": 2
        }
      ]
    }
  ]
}
```

## 7. Realtime 事件

事件 Envelope：

```json
{
  "event_id": "evt_1",
  "event_type": "InventoryConsumed",
  "schema_version": "1.0",
  "household_id": "hh_1",
  "aggregate_id": "lot_1",
  "occurred_at": "2026-07-21T03:00:00Z",
  "correlation_id": "cmd_1",
  "payload": {}
}
```

### 7.1 事件列表

- HouseholdMemberAdded
- InventoryLotCreated
- InventoryConsumed
- InventoryDiscarded
- InventoryCorrected
- InventoryTransactionReversed
- ExpiryStatusChanged
- VoiceJobCompleted
- VoiceCommandConfirmed
- MealPrepared（未来）
- PersonalIntakeRecorded（未来）
- HealthMetricRecorded（未来）
- DietInsightGenerated（未来）

消费者必须按 event_id 幂等。

## 8. 数据所有权

| 表                      | Owner Module   | 其他模块访问方式          |
| ----------------------- | -------------- | ------------------------- |
| households              | Household      | Household Application API |
| food_catalog            | Food Knowledge | Read API                  |
| inventory_lots          | Inventory      | Inventory Query API       |
| inventory_transactions  | Inventory      | Read Model/Event          |
| voice_jobs              | Interaction    | Interaction API           |
| notification_deliveries | Notification   | Notification API          |
| devices                 | Device         | Device API                |
| meals                   | Meal & Intake  | Future API                |
| intake_records          | Meal & Intake  | Future API                |
| health_metrics          | Health         | Future Health API         |
| ai_insights             | AI Agent       | Insight Query API         |

禁止跨模块直接更新非本模块表。

## 9. 关键表结构

### 9.1 inventory_lots

```text
id
household_id
refrigerator_id
storage_zone_id
food_id
initial_quantity_decimal
remaining_quantity_decimal
unit_code
purchased_at
expires_at nullable
expiry_source
status
created_by_member_id
created_at
updated_at
version
```

### 9.2 inventory_transactions

```text
id
household_id
transaction_type
food_id
lot_id nullable
quantity_decimal
unit_code
source_channel
actor_member_id
interaction_id nullable
idempotency_key
reversed_transaction_id nullable
metadata_json
created_at
```

唯一约束：`household_id + idempotency_key`。

### 9.3 voice_jobs

```text
id
household_id
actor_member_id
status
locale
source_channel
audio_duration_ms
audio_quality_json
retention_expires_at
created_at
completed_at
```

### 9.4 nutrition_profiles（未来基础）

```text
id
food_id
basis_quantity_decimal
basis_unit
calories_kcal_decimal
protein_g_decimal
fat_g_decimal
carbohydrate_g_decimal
fiber_g_decimal nullable
sodium_mg_decimal nullable
source_name
source_version
effective_from
```

### 9.5 health_metrics（未来）

```text
id
member_id
metric_type
value_decimal
unit_code
measured_at
source_type
source_reference
confidence
created_at
```

## 10. AI Agent Tool Contract（未来）

Agent 不能直接访问数据库。Tool 示例：

### get_inventory

```json
{
  "name": "get_inventory",
  "input": { "household_id": "hh_1", "as_of": null },
  "output": { "inventory_revision": 128, "items": [] }
}
```

### get_member_nutrition_summary

```json
{
  "name": "get_member_nutrition_summary",
  "input": { "member_id": "m_1", "from": "2026-07-14", "to": "2026-07-21" },
  "output": {
    "coverage": 0.62,
    "totals": {},
    "missing_data_notice": "38% of meals have no confirmed intake."
  }
}
```

### create_recommendation_proposal

只创建待确认建议，不改变事实：

```json
{
  "name": "create_recommendation_proposal",
  "input": {
    "member_id": "m_1",
    "recommendation_type": "MEAL_PLAN",
    "evidence_refs": ["intake:123", "goal:456"],
    "content": {},
    "limitations": []
  },
  "output": { "proposal_id": "prop_1", "status": "PENDING_CONFIRMATION" }
}
```

## 11. Schema 兼容原则

- 新字段优先 optional；
- 不重命名已发布字段，使用新字段并废弃旧字段；
- 事件消费者必须忽略未知字段；
- 破坏性变更使用新 major version；
- 数据库变更先 expand，再 migrate，再 contract；
- Prompt 输出必须使用固定 JSON Schema 和 schema_version。
