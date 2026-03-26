import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  define: {
    'process.env': '{}',
    'process.env.TEST_NATIVE_PLATFORM': JSON.stringify('web'),
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        'process.env': '{}',
        'process.env.TEST_NATIVE_PLATFORM': '"web"',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
      '/socket.io': 'http://localhost:8080',
    },
  },
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
  },
  build: {
    outDir: resolve(__dirname, '../server/public/app'),
    emptyOutDir: true,
  },
});
