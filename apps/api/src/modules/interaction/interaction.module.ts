import { Module } from '@nestjs/common';
import { HouseholdModule } from '../household/household.module';
import { InventoryModule } from '../inventory/inventory.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [HouseholdModule, InventoryModule],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class InteractionModule {}
