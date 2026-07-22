import { Module } from '@nestjs/common';
import { DatabaseModule } from './infra/db/database.module';
import { FoodModule } from './modules/food-knowledge/food.module';
import { HealthModule } from './modules/health/health.module';
import { HouseholdModule } from './modules/household/household.module';
import { InteractionModule } from './modules/interaction/interaction.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { NotificationModule } from './modules/notification/notification.module';
import { MealPlanningModule } from './modules/meal-planning/meal-planning.module';
import { MemberWellnessModule } from './modules/member-wellness/member-wellness.module';
import { NutritionModule } from './modules/nutrition/nutrition.module';
import { AdminModule } from './modules/admin/admin.module';
import { FeedbackModule } from './modules/feedback/feedback.module';

/**
 * 模块化单体入口（docs/02 §7）。
 */
@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    HouseholdModule,
    FoodModule,
    InventoryModule,
    InteractionModule,
    PrivacyModule,
    NotificationModule,
    MealPlanningModule,
    MemberWellnessModule,
    NutritionModule,
    AdminModule,
    FeedbackModule,
  ],
})
export class AppModule {}

