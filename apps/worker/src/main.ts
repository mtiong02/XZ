import { loadWorkerEnv } from './env';

/**
 * Worker 空壳：Sprint 4 起承担 Outbox 轮询、提醒任务和音频清理
 * （docs/02 §11-12、docs/04 Sprint 4）。当前仅输出心跳，验证进程与部署链路。
 */
function main(): void {
  const env = loadWorkerEnv();
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({ msg: 'worker.started', poll_interval_ms: env.WORKER_POLL_INTERVAL_MS }),
  );

  const timer = setInterval(() => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ msg: 'worker.heartbeat', at: new Date().toISOString() }));
  }, env.WORKER_POLL_INTERVAL_MS);

  const shutdown = (signal: string): void => {
    clearInterval(timer);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ msg: 'worker.stopped', signal }));
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
