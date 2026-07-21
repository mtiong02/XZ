import { Module } from '@nestjs/common';
import { DatabaseModule } from './infra/db/database.module';
import { FoodModule } from './modules/food-knowledge/food.module';
import { HealthModule } from './modules/health/health.module';
import { HouseholdModule } from './modules/household/household.module';
import { InventoryModule } from './modules/inventory/inventory.module';

/**
 * 模块化单体入口（docs/02 §7）。
 * interaction（语音）在 Sprint 3 加入；realtime-notification 在 Sprint 4-5 加入。
 */
@Module({
  imports: [DatabaseModule, HealthModule, HouseholdModule, FoodModule, InventoryModule],
})
export class AppModule {}
