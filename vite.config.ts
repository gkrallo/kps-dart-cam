import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// base måste matcha repo-namnet för att GitHub Pages ska hitta assets.
// Vid lokal utveckling och hos Netlify ska den vara '/'.
const base = process.env.GITHUB_ACTIONS ? '/kps-dart-cam/' : '/';

/**
 * Byggversionen syns i ?debug-panelen och i hjälpen. När något beter sig
 * konstigt vid tavlan ska man kunna se VILKEN build som kör - med en service
 * worker som cachar allt är det inte längre självklart att telefonen kör den
 * senaste. Netlify bygger ur en git-klon, så hashen finns där; saknas git
 * (zip-nedladdning o.d.) räcker byggtiden.
 */
function buildVersion(): string {
  const time = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  let hash = '';
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    hash = (process.env.COMMIT_REF ?? '').slice(0, 7);
  }
  return hash ? `${hash} · ${time}` : time;
}

export default defineConfig({
  base,
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Fråga, ladda aldrig om av sig själv: en omladdning mitt i en leg
      // överlevs (matchen är sparad), men den ska ske när spelaren vill.
      // Registreringen görs av UpdateBanner via virtual:pwa-register/react.
      registerType: 'prompt',
      injectRegister: false,
      // public/manifest.webmanifest används som den är. Den har relativa
      // start_url/scope ("./") som fungerar under både '/' och
      // '/kps-dart-cam/' utan att bero på base, och den länkas redan från
      // index.html. Låter vi pluginen generera en egen blir det två manifest
      // att hålla i synk.
      manifest: false,
      workbox: {
        // opencv.js (ca 11 MB) MÅSTE med - utan den startar appen inte, och
        // det är just den man inte vill ladda ner över ett svajigt wifi.
        // Workbox standardtak är 2 MB och då hoppas filen över med bara en
        // varning i byggloggen.
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        // Alla navigeringar (även ?remote och ?debug, som är samma
        // index.html) besvaras ur cachen.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // --host gör att du kan öppna appen från telefonen på samma nät.
    // OBS: kameran kräver HTTPS (eller localhost) för att fungera.
    host: true,
  },
});
