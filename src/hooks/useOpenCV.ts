import { useEffect, useState } from 'react';

declare global {
  interface Window {
    cv: any;
  }
}

// Självhostad: kopieras från npm-paketet @techstark/opencv-js av
// scripts/copy-opencv.mjs. Tidigare laddades den från docs.opencv.org, alltså
// en dokumentationssajt utan tillgänglighetsgarantier - och en 9 MB
// tredjepartsberoende för appens kärnfunktion. Nu ligger den på samma origin,
// vilket också gör den cachebar för offline-läge.
const OPENCV_URL = `${import.meta.env.BASE_URL}opencv.js`;

/**
 * Laddningen ligger i en modulnivå-promise, inte inne i effekten. Den gamla
 * varianten hoppade ur med `if (document.getElementById(id)) return;` när
 * komponenten monterades om, och satte då aldrig isLoaded - appen kunde fastna
 * på "Laddar datorseende-motor". Efter att skriptet laddats pollar vi på
 * `window.cv.Mat` med en 30 s-timeout i stället för att haka på
 * `onRuntimeInitialized`, som kan ha hunnit avfyras redan innan `onload`.
 */
let loader: Promise<any> | null = null;

function loadOpenCV(): Promise<any> {
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    if (window.cv?.Mat) {
      resolve(window.cv);
      return;
    }

    const script = document.createElement('script');
    script.src = OPENCV_URL;
    script.async = true;

    script.onload = () => {
      // Nyare emscripten-byggen lägger en Promise på window.cv; packa upp
      // den till modulobjektet så att pollningen nedan ser rätt värde.
      if (window.cv instanceof Promise) {
        window.cv.then((mod: any) => {
          window.cv = mod;
        }).catch(reject);
      }

      // cv.Mat är den enda "klar"-signalen som finns i alla bygg-varianter.
      // Vi kan inte lita på onRuntimeInitialized här: WASM-runtimen kan
      // redan ha initierats när load-eventet kommer, och då avfyras aldrig
      // en callback vi hakar på i efterhand - det var det som gjorde att
      // appen kunde fastna på "Laddar datorseende-motor". Polla i stället.
      const started = Date.now();
      const poll = window.setInterval(() => {
        if (window.cv?.Mat) {
          window.clearInterval(poll);
          resolve(window.cv);
        } else if (Date.now() - started > 30000) {
          window.clearInterval(poll);
          reject(
            new Error(
              'OpenCV.js laddades men datorseende-motorn initierades inte inom 30 sekunder.',
            ),
          );
        }
      }, 100);
    };

    script.onerror = () => reject(new Error('Det gick inte att ladda OpenCV.js.'));
    document.head.appendChild(script);
  });

  return loader;
}

export const useOpenCV = () => {
  const [cv, setCv] = useState<any>(() => (window.cv?.Mat ? window.cv : null));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOpenCV()
      .then((mod) => !cancelled && setCv(mod))
      .catch((err) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, []);

  return { cv, isLoaded: !!cv, isLoading: !cv && !error, error };
};
