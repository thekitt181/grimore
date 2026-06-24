import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { apiProxyConfig, apiProxySupervisorPlugin } from './vite-plugins/apiProxySupervisor';

export default defineConfig({
  plugins: [react(), apiProxySupervisorPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@grimoire/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@grimoire/monster-dex': path.resolve(__dirname, '../../packages/monster-dex/src'),
      '@grimoire/dice-engine': path.resolve(__dirname, '../../packages/dice-engine/src'),
      '@grimoire/fog-engine': path.resolve(__dirname, '../../packages/fog-engine/src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxyConfig(),
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    esbuild: {
      drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          compendium: ['@grimoire/monster-dex'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', '@grimoire/monster-dex'],
  },
});
