import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infra/db/database.module';
import { HouseholdModule } from '../household/household.module';
import { MealPlanningModule } from '../meal-planning/meal-planning.module';
import { MemberWellnessController } from './member-wellness.controller';
import { MemberWellnessService } from './member-wellness.service';

@Module({
  imports: [DatabaseModule, HouseholdModule, MealPlanningModule],
  controllers: [MemberWellnessController],
  providers: [MemberWellnessService],
  exports: [MemberWellnessService],
})
export class MemberWellnessModule {}
