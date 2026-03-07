import { defineConfig } from 'vite';

// https://vitejs.dev/config
// Main process Vite config - targets Node.js (Electron main process)
export default defineConfig({
  // Override the Forge Vite plugin's default logLevel:'silent' so build errors
  // are visible instead of silently producing a missing .vite/build/index.js
  logLevel: 'error',
  build: {
    rollupOptions: {
      // Externalize all node_modules so Rollup never attempts to bundle them.
      // This prevents native .node addons (e.g. sshcrypto.node from ssh2/docker-modem)
      // from being treated as JavaScript. Electron Forge packages node_modules
      // alongside the app so require() resolves them at runtime.
      external: (id: string) =>
        id === 'electron' ||
        id.startsWith('node:') ||
        id.endsWith('.node') ||
        (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')),
    },
  },
});
