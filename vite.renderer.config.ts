import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
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
