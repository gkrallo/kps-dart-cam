import { useEffect, useRef, useState } from 'react';
import { X, Loader2, ScanLine, AlertTriangle, MonitorSmartphone } from 'lucide-react';
import type { PairingSession } from '../../hooks/useRemoteHost';
import { createQrScanner } from '../../remote/qrScan';
import { QrCode } from './QrCode';
import { CodePaste, CodeShare } from './CodeTools';

interface Props {
  /** Kamerans videoelement - samma ström som avläsningen, ingen ny kamera öppnas. */
  videoElement: HTMLVideoElement | null;
  startPairing: () => Promise<PairingSession>;
  /** Öppnad mitt i en match (från menyn), inte före kalibreringen. */
  midGame: boolean;
  onConnected: () => void;
  onClose: () => void;
}

type Step = 'preparing' | 'offer' | 'answer' | 'connecting';

/** Länk som öppnar fjärrskärmen direkt med koden - surfplattans vanliga kamera-app räcker. */
export function remoteLink(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?remote#${code}`;
}

/**
 * Parkoppling på kamerasidan, i två steg:
 * 1. Visa QR-kod A (en länk med erbjudandet). Fjärrskärmen skannar den.
 * 2. Läs fjärrskärmens QR-kod B med kameran som redan står riktad mot
 *    tavlan - fjärrskärmen hålls upp framför den - eller klistra in koden.
 *
 * Avläsningen står still under tiden (App pausar detektorn): en surfplatta
 * framför tavlan är annars "ett främmande föremål" som efter 8 s tas upp i
 * referensbilden.
 */
export function HostPairing({ videoElement, startPairing, midGame, onConnected, onClose }: Props) {
  const [step, setStep] = useState<Step>('preparing');
  const [session, setSession] = useState<PairingSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const sessionRef = useRef<PairingSession | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    startPairing()
      .then((s) => {
        if (cancelled) {
          s.cancel();
          return;
        }
        sessionRef.current = s;
        setSession(s);
        setStep('offer');
        s.opened.then(() => !cancelled && onConnected()).catch(() => {});
      })
      .catch((e) => {
        console.error('Parkoppling: kunde inte skapa erbjudande', e);
        if (!cancelled) setError('Kunde inte starta parkopplingen. Stöder webbläsaren WebRTC?');
      });
    return () => {
      cancelled = true;
      // Stängs panelen innan kanalen öppnats ska inget hänga kvar.
      sessionRef.current?.cancel();
    };
    // Engångseffekt: en ny parkoppling per öppnad panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitAnswer = async (code: string) => {
    const s = sessionRef.current;
    if (!s || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      await s.acceptAnswer(code);
      setStep('connecting');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Koden gick inte att använda.');
      busyRef.current = false;
    }
  };

  // Läs QR-kod B ur kamerabilden.
  useEffect(() => {
    if (step !== 'answer' || !videoElement) return;
    let stop = false;
    let timer: number | undefined;
    void createQrScanner().then((scanner) => {
      if (stop) return;
      setEngine(scanner.engine);
      const tick = async () => {
        if (stop) return;
        const text = await scanner.scan(videoElement);
        // Kamerans egen kod (en reflex i fjärrskärmens glas) ignoreras tyst.
        if (text && !stop && !busyRef.current && /(^|#)B[zp]/.test(text.trim())) {
          await submitAnswer(text);
        }
        if (!stop) timer = window.setTimeout(() => void tick(), 250);
      };
      void tick();
    });
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, videoElement]);

  // Svaret togs emot men kanalen öppnas inte: oftast olika nät, eller ett
  // gästnät där enheterna inte får prata med varandra. Utan server finns
  // ingen omväg - säg det i stället för att snurra för evigt.
  useEffect(() => {
    if (step !== 'connecting') return;
    const t = window.setTimeout(() => {
      setError('Ingen kontakt med fjärrskärmen. Är båda på samma wifi? Stäng och försök igen.');
    }, 15000);
    return () => window.clearTimeout(t);
  }, [step]);

  const transparent = step === 'answer';

  return (
    <div
      className={`absolute inset-0 z-50 flex flex-col overflow-y-auto ${
        transparent ? 'bg-transparent' : 'bg-slate-950/95 backdrop-blur-sm'
      }`}
    >
      <div
        className={`w-full max-w-md mx-auto flex flex-col gap-3 p-4 ${
          transparent ? 'mt-auto bg-slate-950/90 rounded-t-3xl border-t border-slate-800' : 'py-6'
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-white flex items-center gap-2">
            <MonitorSmartphone className="w-5 h-5 text-blue-400" /> Anslut fjärrskärm
          </h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white" aria-label="Stäng">
            <X className="w-5 h-5" />
          </button>
        </div>

        {midGame && step !== 'answer' && (
          <div className="flex gap-2 items-start bg-amber-950/60 border border-amber-800/60 rounded-xl p-2.5 text-[11px] text-amber-200 leading-snug">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Avläsningen pausas medan du parkopplar. Kontrollera efteråt att stativet inte rubbats –
              har bilden ändrats säger appen till.
            </span>
          </div>
        )}

        {step === 'preparing' && !error && (
          <div className="flex items-center justify-center gap-2 py-10 text-slate-300 text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" /> Förbereder…
          </div>
        )}

        {step === 'offer' && session && (
          <>
            <p className="text-xs text-slate-300 leading-snug">
              <b>1.</b> Skanna koden med fjärrskärmens kamera – den öppnar appen direkt. Eller öppna
              appen med <span className="font-mono">?remote</span> på fjärrskärmen och klistra in koden.
            </p>
            <div className="flex justify-center">
              <QrCode text={remoteLink(session.code)} size={300} />
            </div>
            <CodeShare code={remoteLink(session.code)} shareTitle="DartCam fjärrskärm" />
            <button
              onClick={() => setStep('answer')}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm"
            >
              <ScanLine className="w-4 h-4" /> Nästa: läs fjärrskärmens kod
            </button>
          </>
        )}

        {step === 'answer' && (
          <>
            <p className="text-xs text-slate-300 leading-snug">
              <b>2.</b> Håll upp fjärrskärmens QR-kod framför kameran, en halv meter ifrån. Appen säger
              till när den är ansluten.
              {engine === 'jsQR' && ' (Läser med reservmetoden – håll koden stilla.)'}
            </p>
            <CodePaste label="Anslut med inklistrad kod" onSubmit={(c) => void submitAnswer(c)} />
            <button
              onClick={() => setStep('offer')}
              className="py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold"
            >
              Visa min kod igen
            </button>
          </>
        )}

        {step === 'connecting' && (
          <div className="flex items-center justify-center gap-2 py-10 text-slate-300 text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" /> Ansluter…
          </div>
        )}

        {error && <p className="text-xs text-red-300 bg-red-950/60 rounded-xl p-2.5">{error}</p>}
      </div>
    </div>
  );
}
