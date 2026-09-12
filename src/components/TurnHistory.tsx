import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { MatchState, Seg, ThrowLogEntry } from '../game/types';
import { label as segLabel, score as segScore } from '../game/segments';
import { ThrowEditor } from './ThrowEditor';

interface Props {
  match: MatchState;
  onEditThrow: (actionIndex: number, seg: Seg) => void;
  onDeleteThrow: (actionIndex: number) => void;
  onInsertThrow: (actionIndex: number, seg: Seg) => void;
  onClose: () => void;
}

interface TurnGroup {
  playerId: string;
  playerName: string;
  round: number;
  entries: ThrowLogEntry[];
}

/** Kastlistan grupperad i turer. Loggen är kronologisk, så det räcker att
 *  bryta när spelare eller runda byts. */
function groupTurns(log: ThrowLogEntry[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const e of log) {
    const last = groups[groups.length - 1];
    if (last && last.playerId === e.playerId && last.round === e.round) {
      last.entries.push(e);
    } else {
      groups.push({ playerId: e.playerId, playerName: e.playerName, round: e.round, entries: [e] });
    }
  }
  return groups;
}

/** Hur många turer bakåt som visas. Räcker gott för att rätta i efterhand. */
const MAX_TURNS = 12;

/**
 * Historik över spelade turer där vilket kast som helst går att rätta, ta
 * bort eller komplettera - inte bara den pågående turen (som pilraden i
 * Scoreboard). Motorn har alltid klarat rättningar flera spelare bakåt
 * (ställningen räknas om från kastlistan); det var bara UI:t som saknades.
 *
 * "+" mellan pilarna sätter in en pil på EXAKT den platsen. Ordningen spelar
 * roll: i Farfar avslutas turen när målet nås, och i 301/501 avgör sista
 * pilen om utgången var en dubbel - att bara lägga till sist hade gett fel
 * resultat i båda fallen.
 */
export function TurnHistory({ match, onEditThrow, onDeleteThrow, onInsertThrow, onClose }: Props) {
  const [editing, setEditing] = useState<
    { mode: 'edit' | 'insert'; actionIndex: number; current: Seg | null } | null
  >(null);

  const groups = groupTurns(match.log).slice(-MAX_TURNS).reverse();
  const isFarfar = match.mode === 'FARFAR';

  const insertButton = (actionIndex: number, key: string) => (
    <button
      key={key}
      onClick={() => setEditing({ mode: 'insert', actionIndex, current: null })}
      title="Lägg till en pil som missades här"
      className="w-5 h-10 sm:h-12 rounded-md text-slate-600 hover:text-blue-300 hover:bg-slate-800 flex items-center justify-center shrink-0"
    >
      <Plus className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-sm flex flex-col p-4 overflow-y-auto">
      {editing && (
        <ThrowEditor
          current={editing.current}
          onApply={(seg) => {
            if (editing.mode === 'edit') onEditThrow(editing.actionIndex, seg);
            else onInsertThrow(editing.actionIndex, seg);
            setEditing(null);
          }}
          onDelete={
            editing.mode === 'edit'
              ? () => {
                  onDeleteThrow(editing.actionIndex);
                  setEditing(null);
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}

      <div className="w-full max-w-md mx-auto flex flex-col gap-3 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-white">Turer och rättning</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white" aria-label="Stäng">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-[11px] text-slate-400 leading-snug -mt-1">
          Tryck på en pil för att rätta eller ta bort den. Tryck på <Plus className="w-3 h-3 inline" /> för
          att lägga till en pil som appen missade – på rätt plats i turen.
        </p>

        {groups.length === 0 && (
          <p className="text-sm text-slate-500 py-6 text-center">Inga kast ännu.</p>
        )}

        {groups.map((g) => {
          const sum = g.entries.reduce((t, e) => t + segScore(e.dart), 0);
          const lastAi = g.entries[g.entries.length - 1].ai;
          return (
            <div
              key={`${g.playerId}-${g.round}`}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-3"
            >
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-bold text-slate-200 truncate">
                  {g.playerName}
                  <span className="text-slate-500 font-medium">
                    {' '}· {isFarfar ? 'runda' : 'tur'} {g.round}
                  </span>
                </span>
                <span className="text-xs font-bold text-amber-400 tabular-nums shrink-0">{sum}p</span>
              </div>

              <div className="flex items-center flex-wrap">
                {g.entries.map((e, i) => (
                  <div key={e.ai} className="flex items-center">
                    {insertButton(e.ai, `pre-${e.ai}`)}
                    <button
                      onClick={() => setEditing({ mode: 'edit', actionIndex: e.ai, current: e.dart })}
                      className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl border bg-slate-800 border-blue-500/40 text-blue-300 active:scale-95 flex flex-col items-center justify-center font-bold shrink-0"
                      title={`Pil ${i + 1} – tryck för att rätta`}
                    >
                      <span className="text-xs sm:text-sm">{segLabel(e.dart)}</span>
                      <span className="text-[8px] text-slate-500">{segScore(e.dart)}p</span>
                    </button>
                  </div>
                ))}
                {insertButton(lastAi + 1, `post-${lastAi}`)}
              </div>
            </div>
          );
        })}

        <button
          onClick={onClose}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-sm mt-1"
        >
          Stäng
        </button>
      </div>
    </div>
  );
}
