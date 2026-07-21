import { Module } from '@nestjs/common';
import { HouseholdModule } from '../household/household.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({ imports:[HouseholdModule,InventoryModule], controllers:[NotificationController], providers:[NotificationService], exports:[NotificationService] })
export class NotificationModule {}
