/**
 * QR-läsning ur en videoström.
 *
 * `BarcodeDetector` finns i Chrome på Android (både kameran och Kristians
 * surfplatta) och är snabb och inbyggd. Där den saknas - Safari på iPhone/iPad,
 * Firefox, Chrome på Windows - laddas `jsQR` (ca 45 kB) först när den behövs,
 * så att ingen betalar för den i onödan. OpenCV:s QRCodeDetector används inte:
 * det är inte kontrollerat att den självhostade opencv.js-builden har den,
 * och fjärrskärmen laddar aldrig OpenCV.
 */

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

export interface QrScanner {
  /** Läser en QR-kod i aktuell bildruta. null = ingen kod (än). */
  scan(source: HTMLVideoElement): Promise<string | null>;
  readonly engine: 'BarcodeDetector' | 'jsQR';
}

/** jsQR på full kameraupplösning tar hundratals ms per ruta; QR-koden är stor i bild. */
const JSQR_MAX_SIDE = 640;

async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ['qr_code'];
    if (!formats.includes('qr_code')) return null;
    return new Ctor({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

export async function createQrScanner(): Promise<QrScanner> {
  const native = await nativeDetector();
  if (native) {
    return {
      engine: 'BarcodeDetector',
      async scan(video) {
        if (video.readyState < 2) return null;
        try {
          const found = await native.detect(video);
          return found[0]?.rawValue ?? null;
        } catch {
          return null;
        }
      },
    };
  }

  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    engine: 'jsQR',
    async scan(video) {
      if (!ctx || video.readyState < 2 || !video.videoWidth) return null;
      const s = Math.min(1, JSQR_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.round(video.videoWidth * s);
      const h = Math.round(video.videoHeight * s);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      return jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
    },
  };
}
