import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/.next/',
      '**/coverage/',
      'supabase/.temp/',
      // Next.js 自动生成，不受本仓库 lint 规则约束
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // AGENTS.md: 禁止无理由的 any、非空断言和类型逃逸
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // AGENTS.md: 禁止空 catch、静默失败
      'no-empty': ['error', { allowEmptyCatch: false }],
      // AGENTS.md: 结构化日志；直接 console 需要显式豁免
      'no-console': 'error',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // 冒烟/运维脚本：Node 运行时全局可用，console 是预期输出方式
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  prettier,
);
