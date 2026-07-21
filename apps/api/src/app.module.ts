import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';

/**
 * 模块化单体入口。领域模块（household、food-knowledge、inventory、
 * interaction、realtime-notification）将在 Sprint 1+ 按 docs/02 §7 逐个加入。
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
