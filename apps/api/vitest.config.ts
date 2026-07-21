import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
  plugins: [
    // NestJS 依赖装饰器元数据，vitest 默认的 esbuild 不支持，改用 SWC 编译。
    swc.vite({ module: { type: 'es6' } }),
  ],
});
