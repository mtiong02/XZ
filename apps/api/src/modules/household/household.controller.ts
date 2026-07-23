import {
  Body,
  Controller,
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
  AddMemberSchema,
  CreateHouseholdSchema,
  HouseholdService,
  JoinHouseholdSchema,
} from './household.service';

@Controller('households')
@UseGuards(AuthGuard)
export class HouseholdController {
  constructor(@Inject(HouseholdService) private readonly households: HouseholdService) {}

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const input = CreateHouseholdSchema.parse(body);
    return this.households.createHousehold(user.userId, input);
  }

  @Get()
  async listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.households.listMyHouseholds(user.userId);
  }

  @Post('join')
  async join(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const input = JoinHouseholdSchema.parse(body);
    return this.households.joinHousehold(user.userId, input.invite_code, input.display_name);
  }

  @Get(':householdId/members')
  async listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.households.listMembers(householdId, user.userId);
  }

  @Post(':householdId/members')
  async addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Body() body: unknown,
  ) {
    const input = AddMemberSchema.parse(body);
    return this.households.addMember(householdId, user.userId, input.display_name);
  }

  @Post(':householdId/invites')
  async createInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.households.createInvite(householdId, user.userId);
  }
}
