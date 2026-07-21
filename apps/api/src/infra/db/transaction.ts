import type { Pool, PoolClient } from 'pg';

/**
 * 显式事务边界（docs/07 §2.3）：一个业务命令 = 一个数据库事务。
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // rollback 失败时保留原始错误；连接将被销毁
      client.release(true);
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}
