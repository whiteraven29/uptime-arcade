import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: ['..'] }, // engines/ and content/ live beside frontend/
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  preview: {
    proxy: { '/api': process.env.API_URL || 'http://127.0.0.1:8000' },
  },
  test: { environment: 'node', include: ['src/**/*.test.js'] },
});
