import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 47317,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 47318,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
