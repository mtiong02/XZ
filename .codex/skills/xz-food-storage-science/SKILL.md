---
name: xz-food-storage-science
description: Maintain scientifically sourced food storage-zone rules, shelf-life conditions, placement validation, and user-facing storage guidance for XZ. Use when changing food catalogue storage recommendations, default fridge/freezer/pantry placement, expiry estimation by zone, unsafe or quality-reducing placements, or adding a food whose storage behavior is not yet modeled.
---

# 鲜知食材储存科学

## Workflow

1. Read `references/storage-evidence.md` and the existing `shelf_life_rules` and `food_storage_rules` data.
2. Separate safety from quality. Use `PROHIBITED` only for a defensible safety or physical-state constraint; use `NOT_RECOMMENDED` for quality loss and `ACCEPTABLE` for valid alternatives.
3. Prefer current government, university extension, standards-body, or peer-reviewed sources. Store the direct source URL and a concise condition note. Never turn folk knowledge into an absolute rule without evidence.
4. Add rules in a new migration and update `supabase/seed.sql` for clean rebuilds. Do not rewrite an applied migration.
5. Make automatic placement choose `RECOMMENDED`; reject `PROHIBITED`; explain `NOT_RECOMMENDED` before a confirmed write. Never silently default every food to the refrigerator.
6. Keep package instructions and user-confirmed dates higher priority than catalogue defaults. Model opened/unopened, cut/whole, cooked/raw, temperature, humidity, light, ventilation, and ethylene sensitivity when relevant.
7. Add regressions for default placement, explicit invalid placement, and zone-dependent shelf life. Verify the actual inventory lot lands in the expected zone.

## Required validation

Run API tests, typecheck, lint, `git diff --check`, apply the migration locally, and execute one real add-inventory command. State which rules are evidence-backed, provisional, or still missing.
