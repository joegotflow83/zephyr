import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import path from 'node:path';

// Prevent Rollup/Vite from loading and parsing native .node addon binaries.
// enforce:'pre' ensures this runs before Vite's bundled commonjs plugin.
// The load hook is a safety net: if a .node file somehow bypasses resolveId
// (e.g. resolved to an absolute path by another plugin), we return an empty
// module instead of letting Rollup read the binary from disk.
function nativeNodeModulesPlugin(): Plugin {
  return {
    name: 'native-node-modules',
    enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('.node')) {
        return { id, external: true };
      }
    },
    load(id) {
      if (id.endsWith('.node')) {
        return 'export default {};';
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
  resolve: {
    alias: {
      // cpu-features is a native addon used by ssh2 purely for crypto algorithm
      // selection. Replace with a stub so Vite never tries to bundle the .node
      // binary — ssh2 falls back to its default algorithm set safely.
      'cpu-features': path.resolve(__dirname, 'src/mocks/cpu-features-stub.js'),
    },
  },
  build: {
    rollupOptions: {
      // Externalize all node_modules so Rollup never attempts to bundle them.
      // Electron Forge packages node_modules alongside the app so require()
      // resolves them at runtime.
      // Note: Vite may resolve bare imports (e.g. 'cpu-features') to absolute
      // paths before calling this function, so we also check for node_modules
      // in the resolved path.
      external: (id: string) =>
        id === 'electron' ||
        id.startsWith('node:') ||
        id.endsWith('.node') ||
        id.includes('/node_modules/') ||
        (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')),
    },
  },
});
