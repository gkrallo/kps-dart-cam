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

/**
 * OpenCV.js-bygget vi använder är gammal emscripten och lägger en `then` på
 * modulobjektet som "löser upp" till sig självt och aldrig tar bort sig. Ger man
 * det objektet till en Promise-resolve behandlar JS-motorn det som en thenable,
 * anropar `then`, får tillbaka samma thenable, anropar `then` igen ... en
 * oändlig microtask-loop som fryser huvudtråden. På telefonen syntes det som att
 * appen fastnade för evigt på "Laddar datorseende-motor" (huvudtråden död, så
 * inte ens 30 s-timeouten nedan hann köra). Nyare emscripten gör exakt det här:
 * tar bort `then` så objektet inte längre är thenable. Vi måste göra det själva
 * innan modulen lämnas vidare.
 */
export function unwrapCvModule(mod: any): any {
  if (mod && typeof mod.then === 'function') {
    delete mod.then;
  }
  return mod;
}

function loadOpenCV(): Promise<any> {
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    if (window.cv?.Mat) {
      resolve(unwrapCvModule(window.cv));
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
          resolve(unwrapCvModule(window.cv));
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
  const [cv, setCv] = useState<any>(() => (window.cv?.Mat ? unwrapCvModule(window.cv) : null));
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
