import { HandMetal, X } from 'lucide-react';

interface Props {
  onDismiss: () => void;
}

/**
 * Engångstips efter första turen: dra ut pilarna i omvänd ordning. Se
 * `onHiddenDartRevealed` i useDartDetector.ts/App.tsx och minnesanteckningen
 * `correction-and-readout-wishlist` (idén kommer från hur Darteer.ai gör det).
 */
export function RetrievalTip({ onDismiss }: Props) {
  return (
    <div className="absolute inset-x-3 bottom-3 z-30 sm:inset-x-auto sm:right-3 sm:w-80">
      <div className="bg-slate-900/95 border border-blue-500/40 rounded-2xl shadow-2xl backdrop-blur-md p-3.5 flex gap-3">
        <HandMetal className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-white mb-1">Dra ut pilarna i omvänd ordning</p>
          <p className="text-[11px] text-slate-300 leading-snug">
            Ta ut den sist kastade pilen först, en i taget. Sitter en pil dold
            bakom en annan hittar appen den då automatiskt när den avslöjas,
            i stället för att missa den helt.
          </p>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Stäng tipset"
          className="shrink-0 p-1 text-slate-400 hover:text-white self-start"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
