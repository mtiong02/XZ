import { Module } from '@nestjs/common';
import { HouseholdModule } from '../household/household.module';
import { InventoryCommandService } from './application/inventory-command.service';
import { InventoryQueryService } from './application/inventory-query.service';
import { InventoryController } from './inventory.controller';

@Module({
  imports: [HouseholdModule],
  controllers: [InventoryController],
  providers: [InventoryCommandService, InventoryQueryService],
  exports: [InventoryCommandService, InventoryQueryService],
})
export class InventoryModule {}
