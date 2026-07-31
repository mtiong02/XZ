---
name: xz-voice-regression-learning
description: Diagnose and permanently improve 小知/鲜知 real Chinese voice-dialogue failures. Use when users provide transcripts or report mistakes involving ASR normalization, quantities and units, food aliases, corrections, confirmations, exit/standby, intent routing, inventory writes, reminders, meals, or cross-layer voice-state inconsistencies. Turn each issue into a generalized rule and a full regression-tested release.
---

# XZ Voice Regression Learning

Convert real feedback into durable product behavior. Never patch only the literal food name or phrase from one report.

## Workflow

1. Preserve the literal transcript, timestamps, current task state, system reply, and expected user outcome.
2. Classify the primary owner before editing:
   - Wake word, VAD, interruption, TTS/standby: `apps/speech/src/`.
   - Shared conversation UI or local exit handling: `apps/web/src/components/conversation-modal.tsx`.
   - Normalization, food/quantity/unit extraction: `apps/api/src/modules/interaction/parser/`.
   - Pending candidate, correction, confirmation, execution: `apps/api/src/modules/interaction/voice.service.ts` and `dialogue/`.
   - Catalog aliases, units, storage rules: food knowledge migrations/services.
3. State the invariant that failed. Examples: “吃完 never defaults to 1”, “a correction replaces the old candidate”, “an exit reaches wake-only standby”.
4. Generalize into a bounded deterministic rule. Prefer current inventory lookup for “all/half”, last explicit value for corrections, and robust intent matching for noisy ASR. Do not use an LLM for inventory facts or destructive writes.
5. Update every affected layer. A conversation control rule normally has API, web, and realtime-speech owners; keep their behavior consistent.
6. Add the literal dialogue as a regression fixture and add nearby variants. Keep historical fixtures; never replace old coverage with a new one.
7. Run the complete regression gate and deploy only after all checks pass.

## Safety Rules

- Keep `transcript_raw` unchanged; normalize only for parsing.
- Treat a spoken write as a candidate. Require explicit confirmation before inventory, reminder, or shopping writes.
- For “全部 / 吃完 / 用完 / 一半”, query the current household inventory and confirm the exact resolved quantity. If units are mixed or stock is unavailable, clarify instead of guessing.
- During confirmation, explicit newer food/quantity information replaces the pending candidate; never append an accidental second item.
- Evaluate exit phrases before generic fallback. After exit, cancel pending work and return to wake-word-only standby.
- Any telemetry failure must not block the user-facing task.

## Regression Contract

For every new real dialogue, record these assertions separately:

```text
raw transcript → normalized transcript → intent/task state → candidate → spoken reply → side effect
```

Cover the reported phrase, an ASR-noisy variant, and a neighboring normal phrase. Read `references/regression-maintenance.md` before expanding the corpus.

## Required Checks

```bash
pnpm --filter @xz/api test
pnpm --filter @xz/speech test
pnpm typecheck
NEXT_DIST_DIR=.next-build pnpm build
git diff --check
```

After deployment, verify health, one read-only request, one candidate-and-confirm write, a correction, an exit phrase, and wake-only standby. Report covered behavior and residual ASR uncertainty.
