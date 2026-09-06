import React from 'react';
import { RotateCcw, RefreshCw, Trophy, AlertTriangle, Settings } from 'lucide-react';
import { DartScore } from '../types';

interface ScoreboardProps {
  currentScore: number;
  currentTurnDarts: DartScore[];
  isBust: boolean;
  isWon: boolean;
  onUndo: () => void;
  onReset: () => void;
  isCalibrated: boolean;
  onCalibrateClick: () => void;
  detectorState: string;
  /** Reserverad för felsökning; visas inte i UI:t just nu. */
  noiseLevel?: number;
  motionThreshold: number;
  onThresholdChange: (val: number) => void;
  debugCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  viewMode?: 'live' | 'vision';
  onToggleViewMode?: () => void;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({
  currentScore,
  currentTurnDarts,
  isBust,
  isWon,
  onUndo,
  onReset,
  isCalibrated,
  onCalibrateClick,
  detectorState,
  motionThreshold,
  onThresholdChange,
  debugCanvasRef,
  viewMode = 'live',
  onToggleViewMode,
}) => {
  // Om vi inte är kalibrerade ännu sköts kalibreringsknappen i CalibrationOverlay över videon
  if (!isCalibrated) {
    return null;
  }

  // När kalibreringen är klar visas den fulla 501-instrumentpanelen
  return (
    <div className="bg-slate-900 border-t border-slate-800 shadow-[0_-10px_30px_rgba(0,0,0,0.6)] p-3 sm:p-4 flex flex-col gap-3 z-10 select-none">
      {/* Top row: 501 Big Score + Turn Darts + Game Controls */}
      <div className="flex items-center justify-between gap-2">
        {/* Big Remaining Score */}
        <div className="flex flex-col items-center justify-center bg-slate-950 px-4 py-2 rounded-2xl border border-slate-800 min-w-[120px]">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Aktiv Poäng</span>
          <div className="text-4xl sm:text-5xl font-black tabular-nums tracking-tight text-amber-400">
            {currentScore}
          </div>
        </div>

        {/* Current Turn Darts (3 Slots) */}
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5">
          <div className="flex items-center gap-2">
            {[0, 1, 2].map((index) => {
              const dart = currentTurnDarts[index];
              return (
                <div
                  key={index}
                  className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl border flex flex-col items-center justify-center font-bold text-sm sm:text-base shadow-sm transition-all ${
                    dart
                      ? 'bg-slate-800 border-blue-500/50 text-white scale-105'
                      : 'bg-slate-950/60 border-slate-800 text-slate-600'
                  }`}
                >
                  <span className="text-[9px] font-medium text-slate-500 uppercase -mb-0.5">Pil {index + 1}</span>
                  <span className={dart ? 'text-blue-400 font-black' : 'text-slate-700'}>
                    {dart ? dart.label : '-'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Status Banners */}
          {isBust && (
            <div className="flex items-center gap-1.5 text-xs font-bold text-red-400 bg-red-950/60 px-3 py-1 rounded-full border border-red-800/50 animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5" /> BUST! Poängen återställd
            </div>
          )}
          {isWon && (
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-800/50 animate-bounce">
              <Trophy className="w-3.5 h-3.5" /> VINST! Match slut.
            </div>
          )}
        </div>

        {/* Action buttons: Undo & Reset */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onUndo}
            className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 px-3 py-2 rounded-xl text-xs font-bold border border-slate-700 transition-colors"
            title="Ångra senaste kast"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>Ångra</span>
          </button>

          <button
            onClick={onReset}
            className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 px-3 py-2 rounded-xl text-xs font-bold border border-slate-700 transition-colors"
            title="Nytt Spel (501)"
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
            <span>Nytt 501</span>
          </button>
        </div>
      </div>

      {/* Bottom Controls Bar (Calibration & Vision Debug) */}
      <div className="flex items-center justify-between border-t border-slate-800/80 pt-2.5 text-xs">
        <button
          onClick={onCalibrateClick}
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 border border-slate-700 px-3 py-1.5 rounded-xl font-medium transition-colors text-xs"
        >
          <Settings className="w-3.5 h-3.5 text-slate-400" />
          <span>Kalibrera Om</span>
        </button>

        <div className="flex items-center gap-3">
          {/* Debug canvas preview or Toggle button */}
          {viewMode === 'live' ? (
            <button
              onClick={onToggleViewMode}
              className="flex items-center gap-2 group hover:opacity-95 transition-all"
              title="Klicka för att öppna stor Vision 2D-Vy"
            >
              <span className="text-[10px] text-slate-400 font-medium group-hover:text-emerald-400 transition-colors">Vision 2D:</span>
              <div className="w-8 h-8 bg-black rounded-full overflow-hidden border border-slate-700 group-hover:border-emerald-500 transition-colors relative">
                <canvas ref={debugCanvasRef} width={800} height={800} className="w-full h-full object-cover absolute inset-0" />
              </div>
            </button>
          ) : (
            <button
              onClick={onToggleViewMode}
              className="px-2.5 py-1 bg-emerald-950 text-emerald-300 border border-emerald-700/60 rounded-xl text-[11px] font-bold hover:bg-emerald-900 transition-colors"
            >
              ← Visa Live Kamera
            </button>
          )}

          {/* Detector state pill */}
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span className={`px-2 py-0.5 rounded-full font-bold ${
              detectorState === 'MOTION' ? 'bg-red-950 text-red-400 border border-red-800/40' :
              detectorState === 'STABILIZING' ? 'bg-amber-950 text-amber-400 border border-amber-800/40' :
              detectorState === 'ANALYZING' ? 'bg-blue-950 text-blue-400 border border-blue-800/40' :
              'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
            }`}>
              {detectorState}
            </span>
          </div>

          {/* Skak-tolerans slider */}
          <div className="hidden sm:flex items-center gap-2 bg-slate-950/80 px-2.5 py-1 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400">Skak-Tol:</span>
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
