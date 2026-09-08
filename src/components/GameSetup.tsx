import { useState } from 'react';
import { Plus, Trash2, Play } from 'lucide-react';
import type { CreateMatchOptions } from '../game/match';
import type { GameMode } from '../game/types';

const MODES: { id: GameMode; label: string; sub: string }[] = [
  { id: '301', label: '301', sub: 'Ner till noll' },
  { id: '501', label: '501', sub: 'Ner till noll' },
  { id: 'FARFAR', label: 'Farfar', sub: 'Husregler, +5/runda' },
];

interface Props {
  onStart: (opts: CreateMatchOptions) => void;
  onSkip?: () => void;
}

export function GameSetup({ onStart, onSkip }: Props) {
  const [mode, setMode] = useState<GameMode>('501');
  const [names, setNames] = useState<string[]>(['Spelare 1', 'Spelare 2']);
  const [doubleOut, setDoubleOut] = useState(false);
  const [farfarCap, setFarfarCap] = useState(false);

  const setName = (i: number, v: string) => setNames((n) => n.map((x, j) => (j === i ? v : x)));
  const addPlayer = () => names.length < 8 && setNames((n) => [...n, `Spelare ${n.length + 1}`]);
  const removePlayer = (i: number) => names.length > 1 && setNames((n) => n.filter((_, j) => j !== i));

  const start = () => {
    const players = names.map((name, i) => ({ name: name.trim() || `Spelare ${i + 1}` }));
    onStart({ mode, players, doubleOut: mode !== 'FARFAR' && doubleOut, farfarCap: mode === 'FARFAR' && farfarCap });
  };

  return (
    <div className="absolute inset-0 z-30 bg-slate-950/95 backdrop-blur-sm overflow-y-auto p-4 flex flex-col items-center">
      <div className="w-full max-w-md flex flex-col gap-4 py-6">
        <h2 className="text-xl font-black text-white text-center">Nytt spel</h2>

        {/* Spelläge */}
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex flex-col items-center py-3 rounded-2xl border font-bold transition-all ${
                mode === m.id
                  ? 'bg-blue-600 border-blue-400 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              <span className="text-lg">{m.label}</span>
              <span className="text-[10px] font-medium opacity-80 text-center leading-tight px-1">{m.sub}</span>
            </button>
          ))}
        </div>

        {/* Regelval */}
        {mode !== 'FARFAR' ? (
          <label className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-slate-200">
            <span>Dubbel utgång</span>
            <input
              type="checkbox"
              checked={doubleOut}
              onChange={(e) => setDoubleOut(e.target.checked)}
              className="w-5 h-5 accent-blue-500"
            />
          </label>
        ) : (
          <label className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-slate-200">
            <span>Tak på 100 (avgörs efter runda 18)</span>
            <input
              type="checkbox"
              checked={farfarCap}
              onChange={(e) => setFarfarCap(e.target.checked)}
              className="w-5 h-5 accent-blue-500"
            />
          </label>
        )}

        {/* Spelare */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Spelare</span>
          {names.map((name, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(i, e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500"
                maxLength={16}
              />
              {names.length > 1 && (
                <button
                  onClick={() => removePlayer(i)}
                  className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-500 hover:text-red-400"
                  aria-label="Ta bort spelare"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {names.length < 8 && (
            <button
              onClick={addPlayer}
              className="flex items-center justify-center gap-1.5 bg-slate-900 border border-slate-800 border-dashed rounded-xl py-2.5 text-sm text-slate-400 hover:text-slate-200"
            >
              <Plus className="w-4 h-4" /> Lägg till spelare
            </button>
          )}
        </div>

        <button
          onClick={start}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black py-3.5 rounded-2xl shadow-lg shadow-blue-600/30 transition-all"
        >
          <Play className="w-5 h-5" /> Starta spel
        </button>

        {onSkip && (
          <button onClick={onSkip} className="text-xs text-slate-500 hover:text-slate-300 py-1">
            Hoppa över – bara avläsning utan spel
          </button>
        )}
      </div>
    </div>
  );
}
