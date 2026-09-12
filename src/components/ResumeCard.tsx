import { Play, RotateCcw, Trophy } from 'lucide-react';
import type { MatchState } from '../game/types';

interface Props {
  state: MatchState;
  /** Millisekunder sedan epoch, eller null för en sparning från gamla formatet. */
  lastPlayedAt: number | null;
  onResume: () => void;
  onNewGame: () => void;
  /** Finns bara när matchen är avgjord: samma spelläge och spelare igen. */
  onPlayAgain?: () => void;
}

/** "för 12 minuter sedan", "i går", ... */
function ago(ms: number | null): string {
  if (ms === null) return 'okänt när';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return `för ${s} sekunder sedan`;
  const m = Math.round(s / 60);
  if (m < 90) return `för ${m} minuter sedan`;
  const h = Math.round(m / 60);
  if (h < 36) return `för ${h} timmar sedan`;
  const d = Math.round(h / 24);
  return `för ${d} dagar sedan`;
}

const MODE_LABEL: Record<string, string> = { '301': '301', '501': '501', FARFAR: 'Farfar' };

/**
 * Uppstartskortet när det finns en sparad match.
 *
 * Förut återupptogs den sparade matchen tyst, hur gammal den än var - man kom
 * rakt in i gårdagens spel och första pilen hamnade på fel spelares poäng
 * innan någon hann märka något. Nu visas ställningen först. Är matchen helt
 * färsk (se AUTO_RESUME_MS i App.tsx) hoppas kortet över, för då är det en
 * omladdning eller en skärmsläckare mitt i spelet och man vill bara tillbaka.
 */
export function ResumeCard({ state, lastPlayedAt, onResume, onNewGame, onPlayAgain }: Props) {
  const isFarfar = state.mode === 'FARFAR';
  const done = state.finished;

  return (
    <div className="absolute inset-0 z-30 bg-slate-950/95 backdrop-blur-sm overflow-y-auto p-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-md flex flex-col gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-black text-white">
              {done ? 'Matchen är slut' : 'Fortsätt matchen?'}
            </h2>
            <span className="text-[11px] font-bold text-slate-500 shrink-0">
              {MODE_LABEL[state.mode] ?? state.mode}
              {!isFarfar && state.turnNo ? ` · Tur ${state.turnNo}` : ''}
              {isFarfar && state.round ? ` · Runda ${state.round}` : ''}
            </span>
          </div>

          {done && state.winners.length > 0 && (
            <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
              <Trophy className="w-4 h-4" />
              <span>{state.winners.join(' och ')} vann</span>
            </div>
          )}

          <ul className="flex flex-col gap-1">
            {state.players.map((p, i) => {
              const active = !done && i === state.currentIndex;
              return (
                <li
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl px-3 py-2 border ${
                    active
                      ? 'bg-blue-950/60 border-blue-700/60'
                      : 'bg-slate-950/60 border-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-slate-200 truncate">{p.name}</span>
                    {active && (
                      <span className="text-[10px] uppercase font-black tracking-wider text-blue-400 shrink-0">
                        står på tur
                      </span>
                    )}
                    {isFarfar && p.eliminated && (
                      <span className="text-[10px] uppercase font-black tracking-wider text-red-400 shrink-0">
                        utslagen
                      </span>
                    )}
                  </span>
                  <span className="font-black tabular-nums text-amber-400 shrink-0">
                    {isFarfar ? `${p.savedDarts ?? 0} sparade` : p.score}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="text-[11px] text-slate-500 font-medium">
            Senast spelad {ago(lastPlayedAt)}.
          </p>

          <div className="flex gap-2">
            {done ? (
              <button
                onClick={onPlayAgain}
                className="flex-1 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 transition-all"
              >
                <RotateCcw className="w-4 h-4" />
                Spela igen, samma spelare
              </button>
            ) : (
              <button
                onClick={onResume}
                className="flex-1 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 transition-all"
              >
                <Play className="w-4 h-4" />
                Fortsätt
              </button>
            )}
            <button
              onClick={onNewGame}
              className="flex-1 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-bold py-3 rounded-2xl transition-all"
            >
              Nytt spel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
