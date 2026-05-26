import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',         // localStorage/sessionStorage 접근용
    include: ['src/**/*.test.ts'], // 소스 옆에 *.test.ts colocate
    globals: false,                // explicit imports (vi, describe, it 등)
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/auth/**/*.ts'],
      exclude: ['src/auth/**/*.test.ts', 'src/auth/index.ts'],
    },
  },
});
