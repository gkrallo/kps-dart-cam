import { useEffect, useRef, useState } from 'react';
import { createQrScanner } from '../../remote/qrScan';

interface Props {
  /** Bara koder som klarar testet tas emot - annat (en slumpad QR i rummet) ignoreras. */
  accept: (text: string) => boolean;
  onResult: (text: string) => void;
  onError: (message: string) => void;
}

/**
 * Egen kamera för att läsa en QR-kod - används på fjärrskärmen, som inte har
 * någon kamera igång annars. (Kameran använder sin redan öppna ström, se
 * HostPairing.) Bakre kameran i första hand: man riktar surfplattan mot
 * telefonens skärm.
 */
export function QrCameraScanner({ accept, onResult, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let timer: number | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        });
      } catch {
        onError('Fick inte använda kameran. Klistra in koden i stället.');
        return;
      }
      if (stop || !videoRef.current) return;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const scanner = await createQrScanner();
      setEngine(scanner.engine);
      const tick = async () => {
        if (stop || doneRef.current) return;
        const text = await scanner.scan(video);
        if (text && accept(text) && !doneRef.current) {
          doneRef.current = true;
          onResult(text);
          return;
        }
        timer = window.setTimeout(() => void tick(), 250);
      };
      void tick();
    })();
    return () => {
      stop = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // Kameran öppnas en gång per montering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full aspect-square max-w-xs mx-auto bg-black rounded-2xl overflow-hidden border border-slate-700">
      <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
      <div className="absolute inset-8 border-2 border-dashed border-blue-400/70 rounded-xl pointer-events-none" />
      {engine === 'jsQR' && (
        <span className="absolute bottom-2 inset-x-2 text-center text-[10px] text-slate-300 bg-black/60 rounded">
          Håll koden stilla
        </span>
      )}
    </div>
  );
}
