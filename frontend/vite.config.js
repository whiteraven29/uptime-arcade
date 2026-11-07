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
    // The browser test runs under the policy production sends (deploy/nginx/uptime-arcade.conf).
    headers: process.env.CSP ? { 'Content-Security-Policy': process.env.CSP } : {},
  },
  test: { environment: 'node', include: ['src/**/*.test.js'] },
});
