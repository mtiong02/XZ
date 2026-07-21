import { Controller, Get, Inject, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { NutritionStructureService } from './nutrition.service';

@Controller('households/:householdId/nutrition')
@UseGuards(AuthGuard)
export class NutritionController {
  constructor(
    @Inject(NutritionStructureService) private readonly nutrition: NutritionStructureService,
  ) {}

  @Get('structure')
  structure(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.nutrition.householdStructure(householdId, user.userId);
  }
}
