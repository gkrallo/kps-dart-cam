import { HandMetal, X } from 'lucide-react';

interface Props {
  onDismiss: () => void;
}

/**
 * Engångstips efter första turen: dra ut de pilar som räknats rätt först.
 *
 * Sa tidigare "i omvänd ordning" (lånat från Darteer.ai). Det är fel håll: en
 * pil blir oläst för att något som REDAN satt i tavlan skymde den, alltså en
 * tidigare pil. Drar man ut den sist kastade först tar man bort den skymda och
 * låter den som skymmer sitta kvar. Se `insertIndexForRevealedThrow` i
 * game/match.ts. Ordningen spelar numera ingen roll alls - avstämningen är
 * positionsbaserad (`dartCensus.ts`) - och spelaren kan i praktiken ändå inte
 * minnas kastordningen, men däremot höra vad som räknats.
 */
export function RetrievalTip({ onDismiss }: Props) {
  return (
    <div className="absolute inset-x-3 bottom-3 z-30 sm:inset-x-auto sm:right-3 sm:w-80">
      <div className="bg-slate-900/95 border border-blue-500/40 rounded-2xl shadow-2xl backdrop-blur-md p-3.5 flex gap-3">
        <HandMetal className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-white mb-1">Ta ut de pilar som räknats</p>
          <p className="text-[11px] text-slate-300 leading-snug">
            En i taget, med en kort paus. Ordningen spelar ingen roll - men ta
            de som räknats rätt först. Satt en pil dold bakom en annan blir den
            synlig när den framförvarande tas bort, och appen hittar den då
            automatiskt i stället för att missa den helt.
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
