import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// The @rollup/plugin-commonjs resolver tries to read and parse .node binaries
// before Rollup's external function is consulted, causing a parse error.
// This plugin intercepts .node files in the resolveId phase (which runs first)
// and marks them external so the commonjs plugin never attempts to load them.
function nativeNodeModulesPlugin(): Plugin {
  return {
    name: 'native-node-modules',
    resolveId(id) {
      if (id.endsWith('.node')) {
        return { id, external: true };
      }
    },
  };
}

// https://vitejs.dev/config
// Main process Vite config - targets Node.js (Electron main process)
export default defineConfig({
  // Override the Forge Vite plugin's default logLevel:'silent' so build errors
  // are visible instead of silently producing a missing .vite/build/index.js
  logLevel: 'error',
  plugins: [nativeNodeModulesPlugin()],
  build: {
    rollupOptions: {
      // Externalize all node_modules so Rollup never attempts to bundle them.
      // Electron Forge packages node_modules alongside the app so require()
      // resolves them at runtime.
      external: (id: string) =>
        id === 'electron' ||
        id.startsWith('node:') ||
        id.endsWith('.node') ||
        (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')),
    },
  },
});
