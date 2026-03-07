import { defineConfig } from 'vite';

// https://vitejs.dev/config
// Preload script Vite config - runs in renderer context but has Node.js access
export default defineConfig({
  // Override the Forge Vite plugin's default logLevel:'silent' so build errors
  // are visible instead of silently producing a missing .vite/build/index.js
  logLevel: 'error',
  build: {
    rollupOptions: {
      external: [
        'electron',
        // Treat all native Node addons as external so Rollup never tries to
        // parse the ELF/PE binary as JavaScript.
        /\.node$/,
      ],
    },
  },
});
