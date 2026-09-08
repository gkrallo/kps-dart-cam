import { useState } from 'react';
import { X, Trash2, Check } from 'lucide-react';
import type { Seg } from '../game/types';
import { label as segLabel } from '../game/segments';

interface Props {
  /** Nuvarande pil (för rättning), eller null om det är en ny pil. */
  current: Seg | null;
  onApply: (seg: Seg) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/**
 * Liten knappsats för att rätta en avläst pil. Väljer fält + multiplikator.
 */
export function ThrowEditor({ current, onApply, onDelete, onClose }: Props) {
  const [mult, setMult] = useState<number>(current?.m ?? 1);

  const pick = (v: number, m: number) => onApply({ v, m });

  return (
    <div className="absolute inset-0 z-40 bg-slate-950/95 backdrop-blur-sm flex flex-col p-4 overflow-y-auto">
      <div className="w-full max-w-sm mx-auto flex flex-col gap-3 py-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-slate-200">
            {current ? `Rätta pil (${segLabel(current)})` : 'Ny pil'}
          </span>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white" aria-label="Stäng">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Multiplikator */}
        <div className="grid grid-cols-3 gap-2">
          {[
            [1, 'Enkel'],
            [2, 'Dubbel'],
            [3, 'Trippel'],
          ].map(([m, lbl]) => (
            <button
              key={m}
              onClick={() => setMult(m as number)}
              className={`py-2 rounded-xl font-bold text-sm border transition-all ${
                mult === m ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Fält 1-20 */}
        <div className="grid grid-cols-5 gap-1.5">
          {Array.from({ length: 20 }, (_, i) => i + 1).map((v) => (
            <button
              key={v}
              onClick={() => pick(v, mult)}
              className="py-3 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-bold text-sm transition-all"
            >
              {mult === 3 ? 'T' : mult === 2 ? 'D' : ''}
              {v}
            </button>
          ))}
        </div>

        {/* Bull + Miss */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => pick(25, 1)}
            className="py-3 rounded-lg bg-emerald-800 hover:bg-emerald-700 active:scale-95 text-white font-bold text-sm"
          >
            Grön 25
          </button>
          <button
            onClick={() => pick(25, 2)}
            className="py-3 rounded-lg bg-red-800 hover:bg-red-700 active:scale-95 text-white font-bold text-sm"
          >
            Röd 50
          </button>
          <button
            onClick={() => pick(0, 1)}
            className="py-3 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 font-bold text-sm"
          >
            Miss
          </button>
        </div>

        {current && onDelete && (
          <button
            onClick={onDelete}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-950 border border-red-800/60 text-red-300 font-bold text-sm mt-1"
          >
            <Trash2 className="w-4 h-4" /> Ta bort pilen
          </button>
        )}
        <button
          onClick={onClose}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-sm"
        >
          <Check className="w-4 h-4" /> Avbryt
        </button>
      </div>
    </div>
  );
}
