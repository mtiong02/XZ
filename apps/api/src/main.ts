import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
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
