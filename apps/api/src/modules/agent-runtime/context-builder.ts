import { Injectable } from '@nestjs/common';
import { parseMealContext, type MealContext } from '../interaction/dialogue/meal-recommendations';
import type { FamilyMealContext } from './agent-runtime.types';

export interface MealDecisionContextInput {
  requestText: string;
  inventory: ReadonlyArray<unknown>;
  householdMemberCount?: number;
  expiringItems?: ReadonlyArray<unknown>;
  preferences?: Record<string, unknown>;
  recentMealDialogue?: Array<{ role: string; text: string }>;
  familyContext?: FamilyMealContext | undefined;
}

export interface MealDecisionContext {
  requestText: string;
  normalizedRequest: string;
  occasion: MealContext['occasion'];
  dateReference: MealContext['dateReference'];
  diningMode: MealContext['diningMode'];
  dinerCount: number | null;
  wantsQuick: boolean;
  weightConscious: boolean;
  householdMemberCount: number;
  inventory: ReadonlyArray<unknown>;
  expiringItems: ReadonlyArray<unknown>;
  preferences: Record<string, unknown>;
  recentMealDialogue: Array<{ role: string; text: string }>;
  familyContext: FamilyMealContext | null;
  temporaryContext: {
    occasion: MealContext['occasion'];
    dateReference: MealContext['dateReference'];
    diningMode: MealContext['diningMode'];
    dinerCount: number | null;
  };
  builtAt: string;
}

@Injectable()
export class ContextBuilder {
  build(input: MealDecisionContextInput): MealDecisionContext {
    const requestText = input.requestText.trim();
    const parsed = parseMealContext(requestText);
    return {
      requestText,
      normalizedRequest: requestText.replace(/\s+/g, ' '),
      occasion: parsed.occasion,
      dateReference: parsed.dateReference,
      diningMode: parsed.diningMode,
      dinerCount: parsed.dinerCount,
      wantsQuick: parsed.wantsQuick,
      weightConscious: parsed.weightConscious,
      householdMemberCount: Math.max(1, input.householdMemberCount ?? 1),
      inventory: input.inventory,
      expiringItems: input.expiringItems ?? [],
      preferences: input.preferences ?? {},
      recentMealDialogue: input.recentMealDialogue ?? [],
      familyContext: input.familyContext ?? null,
      temporaryContext: {
        occasion: parsed.occasion,
        dateReference: parsed.dateReference,
        diningMode: parsed.diningMode,
        dinerCount: parsed.dinerCount,
      },
      builtAt: new Date().toISOString(),
    };
  }
}
