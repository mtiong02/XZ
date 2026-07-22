import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infra/db/database.module';
import { HouseholdModule } from '../household/household.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MealPlanningController } from './meal-planning.controller';
import { MealPlanningService } from './meal-planning.service';
import { PersonalizedMealAgentService } from './personalized-meal-agent.service';
import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';

@Module({
  imports: [DatabaseModule, HouseholdModule, InventoryModule, AgentRuntimeModule],
  controllers: [MealPlanningController],
  providers: [MealPlanningService, PersonalizedMealAgentService],
  exports: [MealPlanningService],
})
export class MealPlanningModule {}
