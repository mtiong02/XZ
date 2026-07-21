import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infra/db/database.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NutritionController } from './nutrition.controller';
import { NutritionStructureService } from './nutrition.service';

@Module({
  imports: [DatabaseModule, InventoryModule],
  controllers: [NutritionController],
  providers: [NutritionStructureService],
  exports: [NutritionStructureService],
})
export class NutritionModule {}
