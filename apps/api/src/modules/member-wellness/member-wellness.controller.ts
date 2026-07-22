import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  MemberWellnessService,
  MeasurementEntrySchema,
  WellnessProfileSchema,
  WeightEntrySchema,
} from './member-wellness.service';

@Controller('households/:householdId/wellness/me')
@UseGuards(AuthGuard)
export class MemberWellnessController {
  constructor(@Inject(MemberWellnessService) private readonly wellness: MemberWellnessService) {}

  @Get('profile')
  profile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.wellness.getProfile(householdId, user.userId);
  }

  @Post('profile')
  saveProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Body() body: unknown,
  ) {
    return this.wellness.upsertProfile(householdId, user.userId, WellnessProfileSchema.parse(body));
  }

  @Delete('profile')
  deleteProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.wellness.deleteMyData(householdId, user.userId);
  }

  @Get('weight')
  weight(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.wellness.weightTrend(householdId, user.userId);
  }

  @Post('weight')
  addWeight(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Body() body: unknown,
  ) {
    return this.wellness.addWeight(householdId, user.userId, WeightEntrySchema.parse(body));
  }

  @Delete('weight/:measurementId')
  deleteWeight(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Param('measurementId', ParseUUIDPipe) measurementId: string,
  ) {
    return this.wellness.removeWeight(householdId, user.userId, measurementId);
  }

  @Get('measurements')
  measurements(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.wellness.measurementsSummary(householdId, user.userId);
  }

  @Post('measurements')
  addMeasurement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Body() body: unknown,
  ) {
    return this.wellness.addMeasurement(
      householdId,
      user.userId,
      MeasurementEntrySchema.parse(body),
    );
  }

  @Delete('measurements/:measurementId')
  deleteMeasurement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Param('measurementId', ParseUUIDPipe) measurementId: string,
  ) {
    return this.wellness.removeMeasurement(householdId, user.userId, measurementId);
  }

  @Get('meal-suggestions')
  meals(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.wellness.personalizedMeals(householdId, user.userId);
  }
}
