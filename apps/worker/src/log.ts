/**
 * 结构化日志（AGENTS.md §4）：不记录原始音频、健康数据或密钥。
 */
export function log(
  level: 'info' | 'warn' | 'error',
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...fields });
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}
