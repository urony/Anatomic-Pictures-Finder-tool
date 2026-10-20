import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base יחסי: האתר עובד בכל נתיב משנה של GitHub Pages (/<repository>/) וגם בדומיין מותאם.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'node' },
});
