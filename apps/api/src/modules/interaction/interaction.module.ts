import { Module } from '@nestjs/common';
import { FoodModule } from '../food-knowledge/food.module';
import { HouseholdModule } from '../household/household.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationModule } from '../notification/notification.module';
import { MealPlanningModule } from '../meal-planning/meal-planning.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [
    FoodModule,
    HouseholdModule,
    InventoryModule,
    NotificationModule,
    MealPlanningModule,
    NutritionModule,
    AgentRuntimeModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class InteractionModule {}
