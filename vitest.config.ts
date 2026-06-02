import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': resolve(__dirname, 'src'),
  '@root': resolve(__dirname, '.'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer'),
  '@main': resolve(__dirname, 'src/main'),
};

// postinstall builds better-sqlite3 against Electron's ABI; vitest runs in
// plain Node and needs the Node-ABI build. The shim loads it via
// `nativeBinding`. Scoped to the node project only.
const nodeOnlyAlias = {
  ...alias,
  'better-sqlite3': resolve(__dirname, 'scripts/test-better-sqlite3-shim.ts'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        // All existing tests that run in a Node.js environment.
        extends: true,
        resolve: { alias: nodeOnlyAlias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['**/_*/**', 'src/renderer/tests/browser/**'],
          globalSetup: ['./scripts/vitest-global-setup.ts'],
        },
      },
      {
        // Renderer terminal tests that need a real browser environment
        // (real CSS layout, ResizeObserver, requestAnimationFrame, WebGL).
        extends: true,
        test: {
          name: 'browser',
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
          include: ['src/renderer/tests/browser/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
