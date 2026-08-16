import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { lovinspPlugin } from 'lovinsp';

export default defineConfig({
  main: {
    root: 'src/main',
    envDir: resolve('.'),
    resolve: {
      alias: {
        '@': resolve('src'),
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
      },
    },
    build: {
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'cohub-runtime-adapter': resolve('src/main/core/conversations/cohub-runtime-adapter.ts'),
          'extension-workers/maas-gateway': resolve(
            'src/main/core/extensions/maas-gateway/worker.ts'
          ),
        },
        // legacy-port intentionally lazy-loads db/client + db/kv + settings-service
        // to avoid opening the main sqlite handle before the migration gate runs.
        // The matching dynamic-import warnings are not actionable.
        onwarn(warning, defaultHandler) {
          if (
            warning.code === 'DYNAMIC_IMPORT_WILL_NOT_MOVE_MODULE' ||
            /dynamic import will not move module into another chunk/.test(warning.message ?? '')
          ) {
            return;
          }
          defaultHandler(warning);
        },
      },
    },
  },
  preload: {
    root: 'src/preload',
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
      },
    },
    build: {
      emptyOutDir: true,
    },
  },
  renderer: {
    root: 'src/renderer',
    // Some linked worktrees share the root node_modules directory. Keep the
    // pre-bundled browser dependencies beside each worktree instead of in the
    // shared node_modules/.vite cache: otherwise one Vite server can replace
    // chunk files while another renderer still imports them.
    cacheDir: resolve('.vite/renderer'),
    plugins: [lovinspPlugin({ bundler: 'vite' }), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src'),
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
      },
    },
    server: {
      port: 3000,
    },
  },
});
