import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // geliştirmede WebSocket bağlantısı oyun sunucusuna aktarılır
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
