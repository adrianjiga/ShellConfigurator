import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
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
        statements: 87,
        branches: 77,
        functions: 88,
        lines: 90,
      },
    },
  },
});
