import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Exercise deployment below a non-root path in development and production.
  base: '/demo/',
});
