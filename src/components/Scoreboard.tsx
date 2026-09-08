import React, { useState } from 'react';
import { RotateCcw, RefreshCw, Trophy, AlertTriangle, Settings, SkipForward, Pencil } from 'lucide-react';
import type { MatchState, Seg } from '../game/types';
import { label as segLabel, score as segScore } from '../game/segments';
import { ThrowEditor } from './ThrowEditor';

interface ScoreboardProps {
  match: MatchState | null;
  hasEndTurn: boolean;
  onUndo: () => void;
  onFinishTurn: () => void;
  onEditThrow: (actionIndex: number, seg: Seg) => void;
  onDeleteThrow: (actionIndex: number) => void;
  onNewGame: () => void;
  isCalibrated: boolean;
  onCalibrateClick: () => void;
  detectorState: string;
  motionThreshold: number;
  onThresholdChange: (val: number) => void;
  debugCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  viewMode?: 'live' | 'vision';
  onToggleViewMode?: () => void;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({
  match,
  hasEndTurn,
  onUndo,
  onFinishTurn,
  onEditThrow,
  onDeleteThrow,
  onNewGame,
  isCalibrated,
  onCalibrateClick,
  detectorState,
  motionThreshold,
  onThresholdChange,
  debugCanvasRef,
  viewMode = 'live',
  onToggleViewMode,
}) => {
  const [editIdx, setEditIdx] = useState<number | null>(null);

  if (!isCalibrated || !match) return null;

  const { view, active, currentDarts } = match;
  const isFarfar = match.mode === 'FARFAR';
  const turnLog = currentDarts.length > 0 ? match.log.slice(-currentDarts.length) : [];
  const slots = view.available;
  const editingEntry = editIdx !== null ? match.log.find((l) => l.ai === editIdx) : null;

  return (
    <div className="bg-slate-900 border-t border-slate-800 shadow-[0_-10px_30px_rgba(0,0,0,0.6)] p-3 sm:p-4 flex flex-col gap-3 z-10 select-none">
      {editIdx !== null && (
        <ThrowEditor
          current={editingEntry ? editingEntry.dart : null}
          onApply={(seg) => {
            onEditThrow(editIdx, seg);
            setEditIdx(null);
          }}
          onDelete={() => {
            onDeleteThrow(editIdx);
            setEditIdx(null);
          }}
          onClose={() => setEditIdx(null)}
        />
      )}

      {/* Top row: active player + score */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col items-center justify-center bg-slate-950 px-3 sm:px-4 py-2 rounded-2xl border border-slate-800 min-w-[110px] shrink-0">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider truncate max-w-[120px]">
            {active?.name}
          </span>
          {isFarfar ? (
            <div className="flex items-baseline gap-1">
              <span className="text-3xl sm:text-4xl font-black tabular-nums text-amber-400">{view.total}</span>
              <span className="text-sm text-slate-400 font-bold">/ {view.target}</span>
            </div>
          ) : (
            <div
              className={`text-4xl sm:text-5xl font-black tabular-nums tracking-tight ${
                view.bust ? 'text-red-400 line-through' : 'text-amber-400'
              }`}
            >
              {view.bust ? active?.score : view.remaining}
            </div>
          )}
          <span className="text-[10px] text-slate-500 font-bold">
            {isFarfar ? `Runda ${view.round}` : `Tur ${match.turnNo}`}
          </span>
        </div>

        {/* Turn darts */}
        <div className="flex-1 min-w-[140px] flex flex-col items-center justify-center gap-1.5">
          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            {Array.from({ length: Math.min(slots, 8) }).map((_, index) => {
              const dart = currentDarts[index];
              const ai = turnLog[index]?.ai;
              return (
                <button
                  key={index}
                  disabled={dart === undefined}
                  onClick={() => ai !== undefined && setEditIdx(ai)}
                  className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl border flex flex-col items-center justify-center font-bold shadow-sm transition-all ${
                    dart
                      ? 'bg-slate-800 border-blue-500/50 text-blue-400 active:scale-95'
                      : 'bg-slate-950/60 border-slate-800 text-slate-700'
                  }`}
                >
                  <span className="text-xs sm:text-sm">{dart ? segLabel(dart) : '–'}</span>
                  {dart && <span className="text-[8px] text-slate-500">{segScore(dart)}p</span>}
                </button>
              );
            })}
          </div>

          {/* Checkout hint (x01) */}
          {!isFarfar && view.checkout && view.checkout.length > 0 && (
            <div className="text-[11px] text-emerald-400 font-bold bg-emerald-950/50 px-2.5 py-0.5 rounded-full border border-emerald-800/40">
              Ut: {view.checkout.map(segLabel).join(' ')}
            </div>
          )}
          {match.lastEvent?.type === 'BUST' && (
            <div className="flex items-center gap-1.5 text-xs font-bold text-red-400 bg-red-950/60 px-3 py-1 rounded-full border border-red-800/50 animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5" /> Tjock! Turen räknas som 0
            </div>
          )}
          {match.lastEvent?.type === 'BULL' && (
            <div className="text-xs font-bold text-red-300 bg-red-950/60 px-3 py-1 rounded-full border border-red-800/50">
              Röd bull – turen slut, {match.lastEvent.saved} pilar sparade
            </div>
          )}
          {match.finished && (
            <div className="flex items-center gap-1.5 text-sm font-black text-emerald-400 bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-800/50 animate-bounce">
              <Trophy className="w-4 h-4" /> {match.winners.join(' & ')} vinner!
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={onUndo}
            className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 px-3 py-2 rounded-xl text-xs font-bold border border-slate-700"
            title="Ångra senaste kast"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>Ångra</span>
          </button>
          {hasEndTurn && !match.finished ? (
            <button
              onClick={onFinishTurn}
              className="flex items-center justify-center gap-1.5 bg-blue-700 hover:bg-blue-600 active:scale-95 text-white px-3 py-2 rounded-xl text-xs font-bold border border-blue-500/50"
              title="Avsluta turen manuellt (annars sker det när tavlan töms)"
            >
              <SkipForward className="w-3.5 h-3.5" />
              <span>Nästa</span>
            </button>
          ) : (
            <button
              onClick={onNewGame}
              className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 px-3 py-2 rounded-xl text-xs font-bold border border-slate-700"
              title="Nytt spel"
            >
              <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
              <span>Nytt</span>
            </button>
          )}
        </div>
      </div>

      {/* Bottom Controls Bar (Calibration & Vision Debug) */}
      <div className="flex items-center justify-between border-t border-slate-800/80 pt-2.5 text-xs gap-2">
        <button
          onClick={onCalibrateClick}
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 border border-slate-700 px-3 py-1.5 rounded-xl font-medium text-xs shrink-0"
        >
          <Settings className="w-3.5 h-3.5 text-slate-400" />
          <span>Kalibrera om</span>
        </button>

        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {match.finished ? null : (
            <button
              onClick={onNewGame}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 shrink-0"
            >
              <Pencil className="w-3 h-3" /> Byt spel
            </button>
          )}

          {viewMode === 'live' ? (
            <button onClick={onToggleViewMode} className="flex items-center gap-2 group shrink-0" title="Öppna Vision 2D-vy">
              <span className="hidden sm:inline text-[10px] text-slate-400 font-medium group-hover:text-emerald-400">
                Vision 2D:
              </span>
              <div className="w-8 h-8 bg-black rounded-full overflow-hidden border border-slate-700 group-hover:border-emerald-500 relative">
                <canvas ref={debugCanvasRef} width={800} height={800} className="w-full h-full object-cover absolute inset-0" />
              </div>
            </button>
          ) : (
            <button
              onClick={onToggleViewMode}
              className="px-2.5 py-1 bg-emerald-950 text-emerald-300 border border-emerald-700/60 rounded-xl text-[11px] font-bold shrink-0"
            >
              ← Live
            </button>
          )}

          <span
            className={`px-2 py-0.5 rounded-full font-bold font-mono text-[11px] shrink-0 ${
              detectorState === 'MOTION'
                ? 'bg-red-950 text-red-400 border border-red-800/40'
                : detectorState === 'STABILIZING'
                  ? 'bg-amber-950 text-amber-400 border border-amber-800/40'
                  : detectorState === 'ANALYZING'
                    ? 'bg-blue-950 text-blue-400 border border-blue-800/40'
                    : detectorState === 'CLEARED'
                      ? 'bg-purple-950 text-purple-300 border border-purple-800/40'
                      : 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
            }`}
          >
            {detectorState}
          </span>

          <div className="hidden sm:flex items-center gap-2 bg-slate-950/80 px-2.5 py-1 rounded-xl border border-slate-800 shrink-0">
            <span className="text-[10px] text-slate-400">Skak-tol:</span>
            <input
              type="range"
              min="500"
              max="10000"
              step="500"
              value={motionThreshold}
              onChange={(e) => onThresholdChange(Number(e.target.value))}
              className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[10px] font-mono text-slate-300 w-8">{motionThreshold}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
