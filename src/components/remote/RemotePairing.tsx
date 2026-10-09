import { useEffect, useRef, useState } from 'react';
import { Loader2, ScanLine, ClipboardPaste } from 'lucide-react';
import { WebRtcTransport } from '../../remote/webRtcTransport';
import { QrCode } from './QrCode';
import { CodePaste, CodeShare } from './CodeTools';
import { QrCameraScanner } from './QrCameraScanner';

interface Props {
  /** Kod A som kom med länken (#...), om fjärrskärmen öppnades via kamerans QR-kod. */
  initialOffer: string | null;
  onConnected: (transport: WebRtcTransport) => void;
}

type Step = 'choose' | 'scan' | 'paste' | 'answering' | 'answer';

const isOffer = (text: string) => /(^|#)A[zp]/.test(text.trim());

/**
 * Parkoppling på fjärrskärmen: läs kamerans kod A, visa svaret som QR-kod B
 * som kameran läser. Ingen server är inblandad - koderna ÄR förbindelsen.
 */
export function RemotePairing({ initialOffer, onConnected }: Props) {
  const [step, setStep] = useState<Step>(initialOffer ? 'answering' : 'choose');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transportRef = useRef<WebRtcTransport | null>(null);
  const connectedRef = useRef(false);

  /** Ökas vid varje nytt försök; ett svar som kommer för ett gammalt försök kastas. */
  const genRef = useRef(0);

  const takeOffer = async (code: string) => {
    const gen = ++genRef.current;
    setError(null);
    setStep('answering');
    transportRef.current?.close();
    transportRef.current = null;
    try {
      const { transport, code: answerCode } = await WebRtcTransport.acceptOffer(code);
      if (gen !== genRef.current) {
        transport.close();
        return;
      }
      transportRef.current = transport;
      transport.onStateChange((s) => {
        if (s === 'open' && !connectedRef.current) {
          connectedRef.current = true;
          onConnected(transport);
        }
      });
      setAnswer(answerCode);
      setStep('answer');
    } catch (e) {
      if (gen !== genRef.current) return;
      setError(e instanceof Error ? e.message : 'Koden gick inte att använda.');
      setStep('choose');
    }
  };

  useEffect(() => {
    if (initialOffer) void takeOffer(initialOffer);
    return () => {
      // Lämnas vyn innan kanalen öppnats ska den halvfärdiga förbindelsen
      // bort, och ett försök som ännu inte hunnit svara ska kasta sitt svar.
      genRef.current++;
      if (!connectedRef.current) transportRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-black text-white">Anslut till kameran</h1>

      {step === 'choose' && (
        <>
          <p className="text-sm text-slate-300 leading-snug">
            Tryck <b>Fjärrskärm</b> på telefonen som står vid tavlan. Den visar en QR-kod – skanna den
            här, eller klistra in koden.
          </p>
          <button
            onClick={() => setStep('scan')}
            className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-lg"
          >
            <ScanLine className="w-6 h-6" /> Skanna QR-kod
          </button>
          <button
            onClick={() => setStep('paste')}
            className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold"
          >
            <ClipboardPaste className="w-5 h-5" /> Klistra in kod
          </button>
        </>
      )}

      {step === 'scan' && (
        <>
          <p className="text-sm text-slate-300">Rikta kameran mot QR-koden på telefonen.</p>
          <QrCameraScanner
            accept={isOffer}
            onResult={(text) => void takeOffer(text)}
            onError={(m) => {
              setError(m);
              setStep('paste');
            }}
          />
          <button onClick={() => setStep('choose')} className="py-2 rounded-xl bg-slate-800 text-slate-300 text-sm font-bold">
            Tillbaka
          </button>
        </>
      )}

      {step === 'paste' && (
        <>
          <CodePaste label="Använd koden" onSubmit={(c) => void takeOffer(c)} />
          <button onClick={() => setStep('choose')} className="py-2 rounded-xl bg-slate-800 text-slate-300 text-sm font-bold">
            Tillbaka
          </button>
        </>
      )}

      {step === 'answering' && (
        <div className="flex items-center justify-center gap-2 py-10 text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin text-blue-400" /> Skapar svar…
        </div>
      )}

      {step === 'answer' && answer && (
        <>
          <p className="text-sm text-slate-300 leading-snug">
            Tryck <b>Nästa</b> på telefonen och håll upp den här skärmen framför telefonens kamera,
            en halv meter ifrån. Telefonen säger till när den är ansluten.
          </p>
          <div className="flex justify-center">
            <QrCode text={answer} size={340} />
          </div>
          <p className="text-xs text-slate-500">Utan kamera: kopiera koden och klistra in den på telefonen.</p>
          <CodeShare code={answer} shareTitle="DartCam svar" />
          <button
            onClick={() => {
              transportRef.current?.close();
              setAnswer(null);
              setStep('choose');
            }}
            className="py-2 rounded-xl bg-slate-800 text-slate-300 text-sm font-bold"
          >
            Börja om
          </button>
        </>
      )}

      {error && <p className="text-sm text-red-300 bg-red-950/60 rounded-xl p-3">{error}</p>}
    </div>
  );
}
