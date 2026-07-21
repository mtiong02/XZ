import { Module } from '@nestjs/common';
import { HouseholdController } from './household.controller';
import { HouseholdService } from './household.service';
import { MembershipService } from './membership.service';

@Module({
  controllers: [HouseholdController],
  providers: [HouseholdService, MembershipService],
  exports: [MembershipService],
})
export class HouseholdModule {}
