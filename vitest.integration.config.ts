import { defineConfig } from 'vitest/config';
import path from 'path';

// Vitest configuration for integration tests.
// Uses Node environment for real filesystem I/O and service integration.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/unit/**', 'tests/e2e/**'],
    // Integration tests may take longer
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@components': path.resolve(__dirname, 'src/renderer/components'),
      '@pages': path.resolve(__dirname, 'src/renderer/pages'),
      '@hooks': path.resolve(__dirname, 'src/renderer/hooks'),
      '@stores': path.resolve(__dirname, 'src/renderer/stores'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@services': path.resolve(__dirname, 'src/services'),
    },
  },
});
