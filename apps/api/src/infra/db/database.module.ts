import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ENV, loadEnv, type Env } from '../../config/env';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => loadEnv() },
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env): Pool => new Pool({ connectionString: env.DATABASE_URL, max: 10 }),
    },
  ],
  exports: [ENV, PG_POOL],
})
export class DatabaseModule {}
