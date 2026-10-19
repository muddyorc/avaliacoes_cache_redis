import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O proxy faz o navegador enxergar frontend e API na MESMA origem (DT04):
// o cookie de sessão (Etapa 1) funciona sem CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: { usePolling: process.env.VITE_USE_POLLING === 'true' },
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
