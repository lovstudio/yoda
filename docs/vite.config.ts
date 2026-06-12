import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        design: resolve(__dirname, 'design/index.html'),
        agenticCliMatrix: resolve(__dirname, 'agentic-cli-matrix/index.html'),
        roadmap: resolve(__dirname, 'roadmap/index.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: false,
  },
});
