import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['src/__tests__/helpers/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Without `include`, v8 only reports files the tests happen to import, so an
      // entirely untested file is omitted from the denominator instead of counted as 0%.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/__tests__/**'],
      // Set just under the measured numbers so a regression trips the gate.
      // Ratchet these up as the untested screens gain tests.
      thresholds: {
        statements: 90,
        branches: 81,
        functions: 91,
        lines: 93,
        'src/**/*.{ts,tsx}': {
          perFile: true,
          statements: 75,
          branches: 55,
          functions: 65,
          lines: 75,
        },
      },
    },
  },
});
