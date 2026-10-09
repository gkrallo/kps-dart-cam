import { useEffect } from 'react';

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * Håller skärmen tänd så länge `active` är sant - en fjärrskärm som slocknar
 * mitt i en leg måste någon gå fram och väcka, och då är poängen borta.
 * Webbläsaren släpper låset av sig själv när fliken döljs, så det begärs om
 * när sidan blir synlig igen. Saknas API:t (äldre Safari) händer ingenting.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!active || !wl) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let stopped = false;
    const request = async () => {
      if (stopped || document.visibilityState !== 'visible' || sentinel) return;
      try {
        const s = await wl.request('screen');
        if (stopped) {
          void s.release();
          return;
        }
        sentinel = s;
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
        });
      } catch {
        // Nekat (batterisparläge, ingen användaraktivering än): försök igen
        // vid nästa synlighetsbyte i stället för att störa.
      }
    };
    const onVisible = () => void request();
    document.addEventListener('visibilitychange', onVisible);
    // Även vid tryck: vägrades låset för att sidan inte haft någon
    // användaraktivering räcker första trycket på skärmen.
    document.addEventListener('pointerdown', onVisible);
    void request();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('pointerdown', onVisible);
      void sentinel?.release();
      sentinel = null;
    };
  }, [active]);
}
