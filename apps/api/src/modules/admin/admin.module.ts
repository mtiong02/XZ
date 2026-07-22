import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infra/db/database.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [AdminController],
})
export class AdminModule {}
