# Regression Corpus Maintenance

Use one fixture per concrete failure. Keep the raw phrase in the test name or nearby comment so product feedback remains traceable.

## Fixture Matrix

| Failure family | Minimum variants | Expected invariant |
| --- | --- | --- |
| Quantity and units | normal, Chinese numeral, ASR truncation | Retain the spoken quantity/unit; never silently fall back to 1. |
| All / half inventory | “吃完”, “全部”, “一半” | Resolve against the current household stock before confirmation. |
| Correction | old→new quantity, food replacement, multi-item correction | Replace the pending item rather than appending or retaining the old value. |
| Confirmation | 对, 是的, 可以, 没问题, action suffix | Execute once only after affirmative confirmation. |
| Exit | normal phrase, polite prefix, ASR repetition | Cancel active work and return to wake-only standby. |
| Read-only request | inventory, recipe gap, meal recommendation | Never create a destructive candidate or ask a quantity without an identified food. |

## Test Locations

- Parser/normalization: `apps/api/src/modules/interaction/parser/*.spec.ts`
- Real production regressions: `apps/api/src/modules/interaction/parser/production-regressions.spec.ts`
- Confirmation and exit: `apps/api/src/modules/interaction/dialogue/reply-interpreter.spec.ts`
- Candidate and inventory lookup: `apps/api/src/modules/interaction/voice.service.spec.ts`
- Realtime session end: `apps/speech/src/minimax-realtime.spec.ts`

## Release Note Template

```text
Source dialogue:
Root cause layer:
Generalized invariant:
Fixtures added:
Layers updated:
Checks passed:
Post-release manual scenarios:
Known uncertainty:
```
