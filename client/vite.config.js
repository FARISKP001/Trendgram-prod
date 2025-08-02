import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io': {
        target: 'https://ceremony-ecological-tt-birth.trycloudflare.com',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
