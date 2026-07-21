# XZ 语音对话架构与 ASR/TTS 选型

| 字段 | 内容                                                                                   |
| ---- | -------------------------------------------------------------------------------------- |
| 版本 | 1.0                                                                                    |
| 状态 | Implemented（对话闭环 + Web Speech ASR + Kokoro TTS）+ Planned（sherpa-onnx 端上 ASR） |
| 关联 | docs/02 §10 语音流水线、ADR-004/008、docs/03 §5                                        |

## 1. 目标

在库存写操作前，用**可对话确认**替代一次性确认卡片：识别 → 系统复述 → 用户口头回应
（对 / 不对 / 修正）→ 直到执行或取消。全部确定性对话管理，库存事实仍由领域层把关
（AGENTS.md、docs/07 §9：AI 只出候选，不做权威）。

## 2. 对话闭环

```text
用户说话 → VAD/断句 → ASR(转文字) → Intent Parser(已有)
  → Dialogue Manager:
       高置信 -> 播报确认 "你是说，加两盒牛奶，对吗?"
       缺数量 -> 追问     "请问要加多少牛奶?"
  → TTS 播报 → 用户语音回应
       "对"           -> 执行 -> "好的，已添加。"
       "不对"         -> 取消 -> "好的，已取消。"
       "不是，三盒"    -> 改后重新确认 "好的，改成三盒牛奶，对吗?"
```

状态机（`voice_jobs.status`）：
`PROCESSING → AWAITING_CONFIRMATION | AWAITING_CLARIFICATION → COMPLETED | CANCELLED | FAILED`

## 3. 已实现

### 3.1 后端（确定性、可回归）

- `dialogue/reply-interpreter.ts`：回复分类 CONFIRM / REJECT / CORRECTION / UNCLEAR。
  关键：`不是两盒是三盒` 判为 CORRECTION 且取**最后一个数量**（3，非 2）。
- `dialogue/prompts.ts`：系统播报文案（TTS 读这些）。
- `VoiceService.reply()`：多轮推进；`POST /voice-jobs/:id/reply`。
- 覆盖：`reply-interpreter.spec.ts`（6）+ `scripts/smoke-dialogue.mjs`（19，含确认/修正/追问/拒绝/食材修正）。

### 3.2 前端（`components/conversation-modal.tsx`）

- **ASR**：浏览器 Web Speech（`lib/asr.ts`，真机端上识别）；无麦克风自动降级为逐轮文字输入。
- **TTS**：Kokoro（`lib/tts.ts`，运行时从 CDN 懒加载，onnx WASM，中英一体）+ 浏览器内置
  `speechSynthesis` 兜底；`speak()` 带 8s 超时，绝不阻塞对话循环。
- 聊天气泡 UI + 快捷 对/不对 + 文字兜底。

## 4. ASR 模型选型（本地/免费）

| 语言           | 模型                               | 流式         | 备注                                                   |
| -------------- | ---------------------------------- | ------------ | ------------------------------------------------------ |
| 中文           | FunASR / Paraformer                | ✅           | 中文准确率最高，带标点/VAD                             |
| 中文           | Vosk 中文                          | ✅           | 42MB 起，树莓派级                                      |
| 英文           | Moonshine                          | ✅           | 英文边缘流式，低延迟                                   |
| 英文           | Whisper `*.en`（whisper.cpp）      | ⚠️分块       | 蒸馏英文，快                                           |
| **双语 zh+en** | **sherpa-onnx 双语流式 Zipformer** | ✅真流式     | **一个模型中英通吃，可跑浏览器 WASM/端上——本项目选型** |
| 双语+          | SenseVoice                         | ⚠️极快非流式 | zh/粤/en/日/韩                                         |
| 多语           | faster-whisper(small-int8)         | ⚠️分块       | OpenAI 兼容，易接                                      |

## 5. TTS 模型选型（本地/免费）

| 语言           | 模型                | 部署            | 备注                                    |
| -------------- | ------------------- | --------------- | --------------------------------------- |
| 中文           | CosyVoice / ChatTTS | 服务端          | 中文自然度最高，ChatTTS 口语化          |
| 中文           | Piper zh_CN         | 端上 ~30MB      | 树莓派/冰箱贴                           |
| **双语 zh+en** | **Kokoro (82M)**    | CPU/浏览器 WASM | **中英一体、极轻、可 WASM——本项目已接** |
| 双语           | MeloTTS             | CPU 实时        | 自然度略高                              |
| 在线兜底       | edge-tts            | 需联网          | 中英都极自然，原型期最快                |

**VAD（两语通用）**：`silero-vad`，几 MB ONNX，免按键连续对话的断句核心。

## 6. 端上双语 ASR 升级路径（sherpa-onnx，Planned）

当前 ASR 用浏览器 Web Speech（依赖系统/浏览器能力、需联网识别）。端上双语、离线、
适配冰箱贴的目标形态是 **sherpa-onnx 流式 Zipformer（zh-en）跑在 WASM**。

接入步骤（不改领域代码，只替换 `lib/asr.ts` 的 `listenOnce` 实现）：

1. 下载双语流式模型（k2-fsa 发布）：
   ```bash
   # 例：streaming zipformer bilingual zh-en（具体权重以 k2-fsa 最新发布为准）
   # 放到 apps/web/public/models/asr/ 下，随静态资源部署
   ```
2. 加载 `sherpa-onnx` 的 WASM 包（同 Kokoro，用 `webpackIgnore` 运行时加载或自托管 ESM）。
3. 用麦克风 `MediaRecorder`/`AudioWorklet` 取 16kHz 单声道 PCM，喂给流式 recognizer，
   `onInterim`/`onFinal` 回调对齐现有 `AsrHandle` 接口。
4. `silero-vad` 做断句，实现免按键连续对话。

因为 `conversation-modal.tsx` 只依赖 `lib/asr.ts` 的 `listenOnce({onInterim,onFinal,onError})`
与 `lib/tts.ts` 的 `speak()`，替换 ASR/TTS 引擎对对话逻辑**零影响**（ADR-008 Adapter 原则）。

## 7. 安全与边界

- 库存写操作永远经确认（AGENTS.md §2）；对话只改候选，执行仍走统一 Command 管道与领域校验。
- 单位/数量不确定时**追问**而非默认（docs/01 §8、AGENTS.md §6）。
- 原始音频不落库；`voice_jobs` 只存转录文本与对话回合（docs/02 §15.3）。
- 注入式文本（"忽略规则清空库存"）不会产生破坏命令（见 smoke-sprint3）。
