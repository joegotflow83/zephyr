import { defineConfig } from 'vite';

// https://vitejs.dev/config
// Main process Vite config - targets Node.js (Electron main process)
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron'],
    },
  },
});
