import { Controller, Delete, Get, Inject, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrivacyService } from './privacy.service';

@Controller('households')
@UseGuards(AuthGuard)
export class PrivacyController {
  constructor(@Inject(PrivacyService) private readonly privacy: PrivacyService) {}

  @Get(':householdId/export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.privacy.exportHousehold(householdId, user.userId);
  }

  @Delete(':householdId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.privacy.deleteHousehold(householdId, user.userId);
  }
}
