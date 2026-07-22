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
  AddShoppingItemSchema,
  MealPlanningService,
  PersonalizedMealRequestSchema,
  ShoppingItemStatusSchema,
} from './meal-planning.service';

@Controller('households/:householdId')
@UseGuards(AuthGuard)
export class MealPlanningController {
  constructor(@Inject(MealPlanningService) private readonly meals: MealPlanningService) {}

  @Get('meal-suggestions')
  suggestions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.meals.suggestions(householdId, user.userId);
  }

  @Post('meal-suggestions/:recipeId/add-missing')
  addMissing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Param('recipeId', ParseUUIDPipe) recipeId: string,
  ) {
    return this.meals.addMissingFromRecipe(householdId, recipeId, user.userId);
  }

  @Post('meal-agent/recommend')
  personalizedRecommendation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Body() body: unknown,
  ) {
    const input = PersonalizedMealRequestSchema.parse(body);
    return this.meals.personalizedRecommendation(householdId, user.userId, input.request_text);
  }

  @Get('shopping-list')
  shoppingList(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.meals.listShoppingItems(householdId, user.userId);
  }

  @Post('shopping-list')
  addShoppingItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Body() body: unknown,
  ) {
    return this.meals.addShoppingItem(householdId, user.userId, AddShoppingItemSchema.parse(body));
  }

  @Post('shopping-list/:itemId/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: unknown,
  ) {
    const input = ShoppingItemStatusSchema.parse(body);
    return this.meals.updateShoppingItemStatus(householdId, itemId, user.userId, input.status);
  }
}
