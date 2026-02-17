import { defineConfig } from 'vite';

// https://vitejs.dev/config
// Preload script Vite config - runs in renderer context but has Node.js access
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron'],
    },
  },
});
