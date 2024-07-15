import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vitePluginRequire from 'vite-plugin-require';

// https://vitejs.dev/config/
export default defineConfig({
    base: process.env.GH_PAGES ? '/tvm-viewer/' : './',
    plugins: [
        react(),
        vitePluginRequire({ fileRegex: /(.jsx?|.tsx?|.js?|.vue)$/ }),
    ],
    build: {
        // sourcemap: true,
        target: ['es2020'],
    },
    optimizeDeps: {
        esbuildOptions: {
            target: 'es2020',
        },
        include: ['@emotion/react'],
    },
});
