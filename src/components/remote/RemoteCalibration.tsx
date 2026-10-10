import { Crosshair, Sparkles, CheckCircle2, X, Loader2, ArrowLeft } from 'lucide-react';
import type { CalibrateAction, HostState } from '../../remote/protocol';

interface Props {
  hostState: HostState | null;
  preview: { jpegBase64: string; at: number; wireframe: boolean } | null;
  locked: boolean;
  onAction: (action: CalibrateAction) => void;
  onClose: () => void;
}

/**
 * Kalibrering från fjärrskärmen. Telefonens fäste gungar när man rör den
 * (Kristian 2026-10-09), så hela kalibreringen ska gå att göra härifrån:
 * öppna, Auto, döm bilden, spara - eller avbryt.
 *
 * Bilden är kamerans egen bild med samma wireframe som telefonen ritar. Det
 * man dömer efter är de streckade sektorlinjerna mot tavlans trådar, inte
 * ringarnas form (se CLAUDE.md, kalibreringsflödet).
 */
export function RemoteCalibration({ hostState, preview, locked, onAction, onClose }: Props) {
  const calibrating = !!hostState?.calibrating;
  const busy = !!hostState?.calBusy;
  const canSave = calibrating && hostState?.calStep === 'punkter' && !busy;

  return (
    <div className="absolute inset-0 z-40 bg-slate-950 flex flex-col overflow-y-auto">
      <div className="w-full max-w-3xl mx-auto flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <Crosshair className="w-6 h-6 text-amber-400" /> Kalibrering
          </h2>
          <button onClick={onClose} className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 text-slate-200 font-bold">
            <ArrowLeft className="w-4 h-4" /> Till matchen
          </button>
        </div>

        {calibrating ? (
          <>
            <div className="relative w-full bg-black rounded-2xl overflow-hidden border border-slate-800 min-h-40 flex items-center justify-center">
              {preview ? (
                <img
                  src={`data:image/jpeg;base64,${preview.jpegBase64}`}
                  alt="Kamerans bild med tavlans linjer"
                  className="w-full h-auto"
                />
              ) : (
                <span className="text-slate-500 p-10">Väntar på bild från kameran…</span>
              )}
              {busy && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />
                </div>
              )}
            </div>
            <p className="text-sm text-slate-300 leading-snug">
              {hostState?.calStep === 'sikte'
                ? 'Rikta stativet så att tavlan syns och tryck Auto - kameran zoomar in och letar upp tavlan.'
                : preview?.wireframe
                  ? 'De streckade linjerna ska ligga på tavlans trådar, och ringarna på ringarna. Ser det rätt ut: Spara.'
                  : 'Tryck Auto.'}
            </p>
            {hostState?.calStatus && (
              <p className="text-sm font-semibold text-amber-300 bg-amber-950/50 border border-amber-800/50 rounded-xl px-3 py-2">
                {hostState.calStatus}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              <button
                disabled={locked || busy}
                onClick={() => onAction('auto')}
                className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-amber-500 disabled:opacity-40 text-slate-950 font-black"
              >
                <Sparkles className="w-6 h-6" /> Auto
              </button>
              <button
                disabled={locked || !canSave}
                onClick={() => onAction('save')}
                className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-blue-600 disabled:opacity-40 text-white font-black"
              >
                <CheckCircle2 className="w-6 h-6" /> Spara
              </button>
              <button
                disabled={locked || busy || !hostState?.canCancel}
                onClick={() => onAction('cancel')}
                title="Tillbaka till den sparade kalibreringen, oförändrad"
                className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-slate-800 disabled:opacity-40 text-slate-100 font-bold"
              >
                <X className="w-6 h-6" /> Avbryt
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-300 leading-snug">
              Kameran är kalibrerad. Har stativet rubbats, eller säger kameran att bilden ändrats: kalibrera
              om härifrån. Avläsningen står still tills kalibreringen sparats.
            </p>
            <button
              disabled={locked}
              onClick={() => onAction('open')}
              className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-amber-500 disabled:opacity-40 text-slate-950 font-black text-lg"
            >
              <Crosshair className="w-6 h-6" /> Kalibrera om
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Kamerans "Dra ut alla pilar"-fråga, besvarbar härifrån. Den kommer efter
 * en kalibrering, en parkoppling eller en ny match mitt i en tur, och
 * detektorn står still tills någon svarat.
 */
export function RemoteConfirmEmpty({ locked, onConfirm }: { locked: boolean; onConfirm: () => void }) {
  return (
    <div className="absolute inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-amber-950 border border-amber-500/60 text-amber-100 rounded-3xl p-5 flex flex-col gap-4 text-center">
        <div className="font-black text-2xl">Dra ut alla pilar</div>
        <p className="text-base">
          Kameran tar tavlan som den ser ut när du trycker som "tom". Pilar som sitter kvar räknas aldrig.
          Håll dig och den här skärmen utanför kamerans bild.
        </p>
        <button
          disabled={locked}
          onClick={onConfirm}
          className="py-4 rounded-2xl bg-amber-500 disabled:opacity-40 text-slate-950 font-black text-xl"
        >
          Tavlan är tom
        </button>
      </div>
    </div>
  );
}
