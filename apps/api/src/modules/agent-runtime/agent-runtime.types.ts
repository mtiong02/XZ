export type AgentRiskLevel = 'READ_ONLY' | 'DRAFT' | 'REVERSIBLE_WRITE' | 'EXTERNAL_SIDE_EFFECT';

export type ConfirmationMode = 'NONE' | 'SOFT' | 'STRONG';

export type AgentTaskStatus =
  'ACTIVE' | 'WAITING_CONFIRMATION' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

export type AgentEventType =
  | 'PRODUCT_OPENED'
  | 'FIRST_UTTERANCE'
  | 'MEAL_FLOW_STEP'
  | 'ASSISTANT_SESSION_STARTED'
  | 'TURN_STARTED'
  | 'TURN_COMPLETED'
  | 'CORE_INTENT_RECOGNIZED'
  | 'TASK_CREATED'
  | 'TASK_COMPLETED'
  | 'TASK_CANCELLED'
  | 'MEAL_PLAN_GENERATED'
  | 'MEAL_PLAN_ACCEPTED'
  | 'MEAL_PLAN_MODIFIED'
  | 'MEAL_PLAN_REJECTED'
  | 'SHOPPING_DRAFT_CREATED'
  | 'SHOPPING_CONFIRMED'
  | 'VOICE_FAILURE';

export interface AgentToolContract {
  name: string;
  description: string;
  input: string;
  output: string;
  risk: AgentRiskLevel;
  reversible: boolean;
  requiredPermissions: string[];
  confirmation: ConfirmationMode;
}

export interface AgentEventInput {
  householdId: string;
  actorMemberId?: string | null | undefined;
  sessionId?: string | null | undefined;
  turnId?: string | null | undefined;
  taskId?: string | null | undefined;
  eventType: AgentEventType;
  intent?: string | null | undefined;
  outcome?: string | null | undefined;
  latencyMs?: number | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface FamilyMealContext {
  homeMode: 'FULL_HOUSEHOLD' | 'PARTIAL_HOUSEHOLD' | 'GUESTS' | 'SOLO' | 'UNKNOWN';
  defaultDiners: number;
  memberCount: number;
  members: Array<{
    memberId: string;
    displayName: string;
    goal?: string | null;
    allergens: string[];
    restrictions: string[];
    healthConsiderations: string[];
  }>;
  householdPreferences: {
    favoriteFoods: string[];
    excludedFoods: string[];
    mealStyles: string[];
  };
}
