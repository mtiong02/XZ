import { Module } from '@nestjs/common';
import { FoodCategoryService } from './food-category.service';
import { FoodController } from './food.controller';
import { FoodKnowledgeService } from './food-knowledge.service';
import { HouseholdModule } from '../household/household.module';

@Module({
  controllers: [FoodController],
  imports: [HouseholdModule],
  providers: [FoodCategoryService, FoodKnowledgeService],
  exports: [FoodCategoryService, FoodKnowledgeService],
})
export class FoodModule {}
