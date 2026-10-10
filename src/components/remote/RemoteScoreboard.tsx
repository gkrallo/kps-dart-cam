import { RotateCcw, SkipForward, History, Trophy, AlertTriangle, Plus, RefreshCw, Play } from 'lucide-react';
import type { MatchState } from '../../game/types';
import { label as segLabel, score as segScore } from '../../game/segments';
import { engineFor } from '../../game/match';

interface Props {
  state: MatchState;
  /** Rättning låst: frånkopplad eller ingen kontakt. Ställningen visas ändå. */
  locked: boolean;
  onEditDart: (actionIndex: number) => void;
  onAddDart: () => void;
  onUndo: () => void;
  onEndTurn: () => void;
  onHistory: () => void;
  /** Ny match: öppnar inställningarna (efter en bekräftelse mitt i en match). */
  onNewMatch: () => void;
  /** Avgjord match: samma spelläge och spelare igen, direkt. */
  onPlayAgain: () => void;
}

/**
 * Fjärrskärmens resultattavla. Läses från kastlinjen, 2,4 m bort: den som
 * står på tur och vad hen har kvar är det enda som behöver synas därifrån,
 * så de får nästan hela ytan. Allt annat (övriga spelare, knappar) är för den
 * som står vid skärmen.
 *
 * Porträtt (telefon) staplar; landskap (surfplatta) lägger poängen till
 * vänster och pilarna och spelarna till höger.
 */
export function RemoteScoreboard({
  state,
  locked,
  onEditDart,
  onAddDart,
  onUndo,
  onEndTurn,
  onHistory,
  onNewMatch,
  onPlayAgain,
}: Props) {
  const { view, active, currentDarts } = state;
  const isFarfar = state.mode === 'FARFAR';
  const hasEndTurn = engineFor(state.config).hasEndTurn;
  const turnLog = currentDarts.length > 0 ? state.log.slice(-currentDarts.length) : [];
  const slots = Math.min(view.available, 8);
  const big = isFarfar ? view.total : view.bust ? active.score : view.remaining;

  return (
    <div className="flex-1 grid grid-cols-1 landscape:grid-cols-[1.1fr_1fr] gap-4 p-4 min-h-0">
      {/* Den som står på tur */}
      <section className="flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-3xl p-4 min-h-0">
        {state.finished ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <Trophy className="w-16 h-16 text-amber-400" />
            <div className="text-5xl sm:text-7xl font-black text-emerald-300">{state.winners.join(' & ')}</div>
            <div className="text-2xl font-bold text-slate-300">vinner!</div>
            <div className="flex flex-wrap justify-center gap-3 mt-4">
              <button
                disabled={locked}
                onClick={onPlayAgain}
                className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-blue-600 disabled:opacity-40 text-white font-black text-lg"
              >
                <Play className="w-5 h-5" /> Spela igen, samma spelare
              </button>
              <button
                disabled={locked}
                onClick={onNewMatch}
                className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-800 disabled:opacity-40 text-slate-100 font-bold text-lg"
              >
                <RefreshCw className="w-5 h-5" /> Ny match
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-4xl sm:text-6xl font-black text-white text-center truncate max-w-full">{active.name}</div>
            <div
              className={`font-black tabular-nums leading-none tracking-tight text-[min(34vw,11rem)] landscape:text-[min(22vw,13rem)] ${
                view.bust ? 'text-red-400 line-through' : 'text-amber-400'
              }`}
            >
              {big}
            </div>
            <div className="text-xl sm:text-3xl font-bold text-slate-300 text-center">
              {isFarfar
                ? `Mål ${view.target} · Runda ${view.round} · ${view.available} ${view.available === 1 ? 'pil' : 'pilar'}`
                : `Tur ${state.turnNo}`}
            </div>
            {!isFarfar && view.checkout && view.checkout.length > 0 && (
              <div className="mt-2 text-xl sm:text-2xl text-emerald-300 font-black bg-emerald-950/60 px-4 py-1 rounded-full border border-emerald-800/50">
                Ut: {view.checkout.map(segLabel).join(' ')}
              </div>
            )}
            {state.lastEvent?.type === 'BUST' && (
              <div className="mt-2 flex items-center gap-2 text-xl font-black text-red-300">
                <AlertTriangle className="w-6 h-6" /> Tjock
              </div>
            )}
            {state.lastEvent?.type === 'BULL' && (
              <div className="mt-2 text-xl font-black text-red-300">
                Röd bull – {state.lastEvent.saved} pilar sparade
              </div>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-4 min-h-0">
        {/* Turens pilar - tryck för att rätta */}
        {!state.finished && (
          <div className="flex flex-wrap gap-3 justify-center">
            {Array.from({ length: slots }).map((_, i) => {
              const dart = currentDarts[i];
              const entry = turnLog[i];
              const unsure = !!entry?.alt?.length;
              const canAdd = !dart && i === currentDarts.length;
              const disabled = locked || (!dart && !canAdd);
              return (
                <button
                  key={i}
                  disabled={disabled}
                  onClick={() => (dart && entry ? onEditDart(entry.ai) : canAdd && onAddDart())}
                  title={canAdd ? 'Lägg till en pil som kameran missade' : unsure ? 'Satt nära gränsen – tryck för att rätta' : 'Tryck för att rätta'}
                  className={`w-24 h-24 sm:w-28 sm:h-28 rounded-2xl border-2 flex flex-col items-center justify-center font-black transition-all ${
                    dart
                      ? unsure
                        ? 'bg-slate-800 border-amber-400 text-amber-300'
                        : 'bg-slate-800 border-blue-500/60 text-blue-200'
                      : canAdd
                        ? 'bg-slate-950 border-dashed border-slate-600 text-slate-500'
                        : 'bg-slate-950 border-slate-800 text-slate-700'
                  } ${disabled ? 'opacity-60' : 'active:scale-95'}`}
                >
                  {dart ? (
                    <>
                      <span className="text-3xl sm:text-4xl">{segLabel(dart) + (unsure ? '?' : '')}</span>
                      <span className="text-sm text-slate-400">{segScore(dart)}p</span>
                    </>
                  ) : canAdd ? (
                    <Plus className="w-8 h-8" />
                  ) : (
                    <span className="text-3xl">–</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Alla spelare */}
        <ul className="flex flex-col gap-1.5 bg-slate-900 border border-slate-800 rounded-3xl p-3 overflow-y-auto min-h-0">
          {state.players.map((p, i) => {
            const current = !state.finished && i === state.currentIndex;
            return (
              <li
                key={p.id}
                className={`flex items-center justify-between gap-3 px-3 py-2 rounded-2xl ${
                  current ? 'bg-blue-950/70 border border-blue-700/60' : ''
                } ${p.eliminated ? 'opacity-50 line-through' : ''}`}
              >
                <span className={`text-xl sm:text-2xl font-bold truncate ${current ? 'text-white' : 'text-slate-300'}`}>
                  {current && '▶ '}
                  {p.name}
                </span>
                <span className="text-xl sm:text-2xl font-black tabular-nums text-amber-300 shrink-0">
                  {isFarfar ? `${p.savedDarts ?? 0} sparade` : p.score}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="grid grid-cols-4 gap-2 mt-auto">
          <button
            disabled={locked}
            onClick={onUndo}
            className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl bg-slate-800 disabled:opacity-40 text-slate-100 font-bold"
          >
            <RotateCcw className="w-6 h-6 text-amber-400" /> Ångra
          </button>
          <button
            disabled={locked || !hasEndTurn || state.finished}
            onClick={onEndTurn}
            title={hasEndTurn ? 'Avsluta turen och gå till nästa spelare' : 'Farfar avslutar turen själv'}
            className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl bg-slate-800 disabled:opacity-40 text-slate-100 font-bold"
          >
            <SkipForward className="w-6 h-6 text-slate-300" /> Nästa spelare
          </button>
          <button
            disabled={locked}
            onClick={onHistory}
            className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl bg-slate-800 disabled:opacity-40 text-slate-100 font-bold"
          >
            <History className="w-6 h-6 text-blue-300" /> Turer
          </button>
          <button
            disabled={locked}
            onClick={onNewMatch}
            className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl bg-slate-800 disabled:opacity-40 text-slate-100 font-bold"
          >
            <RefreshCw className="w-6 h-6 text-slate-300" /> Ny match
          </button>
        </div>
      </section>
    </div>
  );
}
