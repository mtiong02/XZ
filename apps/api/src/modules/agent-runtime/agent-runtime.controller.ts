import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MembershipService } from '../household/membership.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { FamilyContextService } from './family-context.service';

const FamilyMealProfileSchema = z.object({
  household_id: z.string().uuid(),
  home_mode: z
    .enum(['FULL_HOUSEHOLD', 'PARTIAL_HOUSEHOLD', 'GUESTS', 'SOLO', 'UNKNOWN'])
    .optional(),
  default_diners: z.number().int().min(1).max(30).optional(),
  favorite_foods: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  excluded_foods: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  meal_styles: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});

const AgentEventSchema = z.object({
  household_id: z.string().uuid(),
  event_type: z.enum([
    'PRODUCT_OPENED',
    'FIRST_UTTERANCE',
    'MEAL_FLOW_STEP',
    'ASSISTANT_SESSION_STARTED',
    'TURN_STARTED',
    'TURN_COMPLETED',
    'CORE_INTENT_RECOGNIZED',
    'TASK_CREATED',
    'TASK_COMPLETED',
    'TASK_CANCELLED',
    'MEAL_PLAN_GENERATED',
    'MEAL_PLAN_ACCEPTED',
    'MEAL_PLAN_MODIFIED',
    'MEAL_PLAN_REJECTED',
    'SHOPPING_DRAFT_CREATED',
    'SHOPPING_CONFIRMED',
    'VOICE_FAILURE',
  ]),
  session_id: z.string().uuid().optional(),
  turn_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  intent: z.string().trim().max(80).optional(),
  outcome: z.string().trim().max(80).optional(),
  latency_ms: z.number().int().min(0).max(600_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

@Controller('agent-runtime')
@UseGuards(AuthGuard)
export class AgentRuntimeController {
  constructor(
    private readonly runtime: AgentRuntimeService,
    private readonly membership: MembershipService,
    private readonly familyContext: FamilyContextService,
  ) {}

  @Post('events')
  async record(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const input = AgentEventSchema.parse(body);
    const member = await this.membership.assertMembership(input.household_id, user.userId);
    await this.runtime.recordEvent({
      householdId: input.household_id,
      actorMemberId: member.memberId,
      sessionId: input.session_id,
      turnId: input.turn_id,
      taskId: input.task_id,
      eventType: input.event_type,
      intent: input.intent,
      outcome: input.outcome,
      latencyMs: input.latency_ms,
      metadata: input.metadata,
    });
    return { ok: true };
  }

  @Post('family-context')
  async updateFamilyContext(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const input = FamilyMealProfileSchema.parse(body);
    await this.membership.assertMembership(input.household_id, user.userId);
    return this.familyContext.upsert(input.household_id, {
      homeMode: input.home_mode,
      defaultDiners: input.default_diners,
      favoriteFoods: input.favorite_foods,
      excludedFoods: input.excluded_foods,
      mealStyles: input.meal_styles,
    });
  }
}
