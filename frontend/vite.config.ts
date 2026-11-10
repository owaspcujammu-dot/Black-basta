import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Where the dev server forwards /api. Set VITE_API_PROXY in the repo-root .env
  // if the backend does not run on port 5000. (PORT is deliberately not read
  // here: tools that launch Vite often set PORT to Vite's own port.)
  const env = loadEnv(mode, '..', 'VITE_');
  const backend = env.VITE_API_PROXY || 'http://localhost:5000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin in development: the browser only ever talks to :5173,
      // so session cookies and the SSE stream work exactly as in production.
      proxy: {
        '/api': { target: backend, changeOrigin: false },
      },
    },
    build: {
      target: 'es2020',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            motion: ['framer-motion'],
          },
        },
      },
    },
  };
});
