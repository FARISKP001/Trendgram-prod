import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Dev proxy to legacy server removed; Worker serves APIs at http://localhost:8787
});
