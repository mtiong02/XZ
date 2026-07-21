import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
// 加载仓库根目录 .env（apps/api/{src,dist}/main.* 距根三级）
loadDotenv({ path: resolve(__dirname, '../../../.env') });
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { ProblemDetailsFilter } from './shared/problem-details.filter';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ msg: 'api.started', port: env.API_PORT }));
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ msg: 'api.bootstrap_failed', error: String(error) }));
  process.exit(1);
});
