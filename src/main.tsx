import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { UpdateBanner } from './components/UpdateBanner';
import { BUILD_VERSION } from './buildInfo';
import './index.css';

// För tools/check.mjs och reload.mjs, som läser versionen över CDP. Alltid
// satt, inte bara med ?debug: det är just när fliken körs utan ?debug som
// man vill kunna se att det är fel bygge också.
(window as unknown as { __buildVersion: string }).__buildVersion = BUILD_VERSION;

// Fjärrskärmen (?remote) och kameraappen är var sin chunk. Fjärrskärmen får
// aldrig importera CameraFeed, useOpenCV eller useDartDetector: det är vad
// som gör att den varken ber om kameran eller laddar de 10 MB opencv.js. App
// bakom lazy kostar enhetsläget en extra liten fil, som service workern
// ändå har i cachen.
const isRemote = new URLSearchParams(window.location.search).has('remote');

// Installeras fjärrskärmen på hemskärmen ska den öppna ?remote, i helskärm
// och i valfri riktning (surfplattan står ofta på tvären) - inte kameraappen
// i stående läge. Samma index.html för båda, så manifestet byts här.
if (isRemote) {
  document
    .querySelector('link[rel="manifest"]')
    ?.setAttribute('href', `${import.meta.env.BASE_URL}manifest-remote.webmanifest`);
}
const Root = isRemote ? lazy(() => import('./RemoteApp')) : lazy(() => import('./App'));

// UpdateBanner ligger bredvid roten, inte inuti, så att samma rad gäller för
// både kameran och fjärrskärmen.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="fixed inset-0 bg-slate-950" />}>
      <Root />
    </Suspense>
    <UpdateBanner />
  </StrictMode>,
);
