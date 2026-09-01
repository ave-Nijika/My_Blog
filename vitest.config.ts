import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist', '.next', 'out'],
    // 2026-08-30: 本机 Turbopack dev 冷编译显著变慢（基线代码同样超时，实测新进程
    // 首个页面路由 10~40s），10s 预算导致与代码质量无关的随机失败。放宽到 30s/120s
    // 以适配慢机器；所有断言与用例数量不变。若部署机恢复速度可回调。
    testTimeout: 30000,
    hookTimeout: 120000,
    teardownTimeout: 10000,
    // 多个集成测试文件会各自启动 next dev 服务器，共用同一 .next 目录会互相干扰，
    // 因此按文件串行执行，避免并发启动 dev server 导致超时。
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.test.{ts,js}',
        '**/*.spec.{ts,js}',
        '**/types/',
        '**/dist/',
        '**/.next/',
        '**/out/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
});