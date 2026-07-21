import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { WriteRateLimitGuard } from '../../shared/rate-limit.guard';
import { CommandRequestSchema } from './application/command-request';
import { InventoryCommandService } from './application/inventory-command.service';
import { InventoryQueryService } from './application/inventory-query.service';
import { DomainError } from './domain/errors';

@Controller()
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(
    private readonly commands: InventoryCommandService,
    private readonly queries: InventoryQueryService,
  ) {}

  /** 统一命令入口（docs/03 §6）。写操作限流。 */
  @Post('commands')
  @UseGuards(WriteRateLimitGuard)
  async executeCommand(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const request = CommandRequestSchema.parse(body);
    return this.commands.execute(request, user.userId);
  }

  @Get('households/:householdId/inventory')
  async getInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.queries.getInventoryView(householdId, user.userId);
  }

  @Get('households/:householdId/inventory/expiring')
  async getExpiring(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Query('days', new DefaultValuePipe(3), ParseIntPipe) days: number,
  ) {
    if (days < 0 || days > 30) {
      throw new DomainError('VALIDATION', 'INVALID_RANGE', 'days must be between 0 and 30.');
    }
    return this.queries.getExpiring(householdId, user.userId, days);
  }

  @Get('households/:householdId/transactions')
  async getTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit?: number,
  ) {
    const pageSize = Math.min(Math.max(limit ?? 30, 1), 100);
    return this.queries.getTransactions(householdId, user.userId, cursor, pageSize);
  }

  @Get('households/:householdId/stats')
  async getStats(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.queries.getWeeklyStats(householdId, user.userId);
  }

  @Get('households/:householdId/foods/:foodId/detail')
  async getFoodDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Param('foodId', ParseUUIDPipe) foodId: string,
  ) {
    const detail = await this.queries.getFoodDetail(householdId, user.userId, foodId);
    if (!detail) {
      throw new DomainError('NOT_FOUND', 'FOOD_NOT_FOUND', 'Food not found.');
    }
    return detail;
  }
}
