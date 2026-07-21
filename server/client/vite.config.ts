import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function appVersionPlugin(): Plugin {
  let buildId = '';
  let builtAt = '';

  return {
    name: 'sgp-app-version',
    apply: 'build',
    buildStart() {
      buildId = `${Date.now().toString(36)}`;
      builtAt = new Date().toISOString();
    },
    transformIndexHtml() {
      return [{
        tag: 'meta',
        attrs: { name: 'sgp-app-build-id', content: buildId },
        injectTo: 'head',
      }];
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId, builtAt }),
      });
    },
  };
}

export default defineConfig({
  plugins: [appVersionPlugin(), react(), tailwindcss()],
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
      '/socket.io': {
        target: 'http://localhost:8080',
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
  },
  build: {
    outDir: resolve(__dirname, '../public/app'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) {
            return 'vendor-three';
          }
          if (id.includes('/src/app/components/MotorSceneCanvas') || id.includes('/src/app/components/ThreeDPage')) {
            return 'app-3d';
          }
        },
      },
    },
  },
});
