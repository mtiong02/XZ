---
name: xz-food-knowledge-builder
description: Maintain XZ food taxonomy, household food catalogues, units, aliases, and voice-recognition regressions. Use when adding food categories, custom foods, food aliases, default units, shelf life, or correcting ingredient recognition and inventory lookup.
---

# XZ 食材知识构建

Use the taxonomy and alias rules in [references/food-taxonomy.md](references/food-taxonomy.md) before changing food knowledge.

## Workflow

1. Locate the food in the taxonomy; create a migration for a new category or alias. Keep `food_catalog.category_code` at a leaf or nearest specific node.
2. Use `food_aliases` for individual food spoken names. Use `food_category_aliases` only for category queries.
3. For household custom foods, validate membership, category leaf status, supported units, duplicate names, and alias normalization in the Food Knowledge application service. Do not write these tables from controllers or UI.
4. Preserve the inventory boundary: catalog changes do not modify stock; stock changes must use a confirmed inventory command with an idempotency key.
5. Add a focused regression for normalization, parsing, category lookup, or the corresponding API behavior. Verify that the speech catalog loads the new food and that a category query still returns all descendants.

## Required validation

Run API typecheck and the food-knowledge tests. Apply migrations locally, then verify a real household can create the food, list it through `/households/:householdId/foods`, and send its canonical name or alias through the voice path. Do not log raw transcripts or credentials.
