import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// base måste matcha repo-namnet för att GitHub Pages ska hitta assets.
// Vid lokal utveckling ska den vara '/'.
const base = process.env.GITHUB_ACTIONS ? '/kps-dart-cam/' : '/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // --host gör att du kan öppna appen från telefonen på samma nät.
    // OBS: kameran kräver HTTPS (eller localhost) för att fungera.
    host: true,
  },
});
