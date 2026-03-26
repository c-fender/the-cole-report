import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  // `vite preview` does not inherit `server.proxy` — without this, /api/* returns 404 locally.
  preview: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
