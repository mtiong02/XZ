import { Module } from '@nestjs/common';
import { DatabaseModule } from './infra/db/database.module';
import { FoodModule } from './modules/food-knowledge/food.module';
import { HealthModule } from './modules/health/health.module';
import { HouseholdModule } from './modules/household/household.module';
import { InteractionModule } from './modules/interaction/interaction.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PrivacyModule } from './modules/privacy/privacy.module';

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
  ],
})
export class AppModule {}
