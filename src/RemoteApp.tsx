import { useEffect, useRef, useState } from 'react';
import { RemotePairing } from './components/remote/RemotePairing';
import { RemoteScoreboard } from './components/remote/RemoteScoreboard';
import { RemoteStatusBar, type RemoteStatus } from './components/remote/RemoteStatusBar';
import { ThrowEditor } from './components/ThrowEditor';
import { TurnHistory } from './components/TurnHistory';
import { GameSetup } from './components/GameSetup';
import { RemoteCalibration, RemoteConfirmEmpty } from './components/remote/RemoteCalibration';
import { FullscreenToggle } from './components/remote/FullscreenToggle';
import { useRemoteReplica } from './hooks/useRemoteReplica';
import { useWakeLock } from './hooks/useWakeLock';
import { label as segLabel } from './game/segments';
import type { RemoteOp, StartMatchConfig } from './remote/protocol';
import type { MatchState } from './game/types';

/** Livstecken var 5:e s; hörs kameran inte på 15 s är kanalen tyst (wifiglapp). */
const PING_MS = 5000;
const SILENT_AFTER_MS = 15000;

/** Koden i adressens fragment (#...), om fjärrskärmen öppnades via kamerans QR-kod. */
function takeOfferFromHash(): string | null {
  const code = window.location.hash.slice(1);
  if (!code) return null;
  // Erbjudandet går bara att använda en gång. Ligger det kvar i adressen
  // försöker en omladdning ansluta med en död kod i stället för att visa
  // den sparade ställningen.
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return code;
}

/**
 * En gång per sidladdning, utanför React: StrictMode kör useState-
 * initieraren två gånger, och den andra hade hittat ett redan tömt fragment.
 */
let offerFromHash: string | null | undefined;
const initialOfferOnce = () => (offerFromHash === undefined ? (offerFromHash = takeOfferFromHash()) : offerFromHash);

type Dialog =
  | { kind: 'edit'; actionIndex: number; version: number }
  | { kind: 'add'; version: number }
  | { kind: 'undo'; version: number; text: string }
  | { kind: 'endTurn'; text: string }
  | { kind: 'newMatch' }
  | null;

/** Förra matchens upplägg - inställningarna förifylls, och "Spela igen" tar det rakt av. */
function configOf(state: MatchState | null): StartMatchConfig | undefined {
  if (!state) return undefined;
  const c = state.config;
  return { mode: c.mode, doubleOut: c.doubleOut, farfarCap: c.farfarCap, players: c.players.map((p) => ({ name: p.name })) };
}

/**
 * Fjärrskärmen (?remote). Laddar aldrig kameran, OpenCV eller detektorn -
 * den importerar inget av det, och main.tsx väljer den här komponenten i
 * stället för App innan något av det hunnit laddas.
 *
 * Ändrar aldrig matchen själv: varje knapp blir ett förslag till kameran,
 * och det som syns är alltid kamerans senaste bild.
 */
export default function RemoteApp() {
  const [initialOffer] = useState(initialOfferOnce);
  const { replica, connect } = useRemoteReplica();
  const [pairing, setPairing] = useState(() => initialOffer !== null || replica.match === null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showCal, setShowCal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [, setTick] = useState(0);
  /** Versionen när en pil i Turer valdes, se onEditorOpen. */
  const historyVersionRef = useRef<number | null>(null);

  useWakeLock(true);

  // Livstecken, och en omritning så att "ingen kontakt" visas i tid.
  useEffect(() => {
    const t = window.setInterval(() => {
      replica.ping();
      setTick((n) => n + 1);
    }, PING_MS);
    return () => window.clearInterval(t);
  }, [replica]);

  const state = replica.state;
  const status: RemoteStatus = !replica.connected
    ? { kind: 'disconnected', since: replica.lastHeardAt ?? replica.receivedAt }
    : replica.isFresh(SILENT_AFTER_MS)
      ? { kind: 'connected' }
      : { kind: 'silent', since: replica.lastHeardAt };
  const locked = status.kind !== 'connected';
  const hostState = replica.connected ? replica.hostState : null;

  // Öppnas kalibreringen på kameran (härifrån eller på telefonen) visas den
  // här också, och den stängs när kalibreringen sparats.
  const calibrating = !!hostState?.calibrating;
  useEffect(() => {
    setShowCal(calibrating);
  }, [calibrating]);

  // Tappas kontakten mitt i en rättning stängs den - ett förslag kan ändå
  // inte skickas, och knappsatsen ska inte se ut att fungera.
  useEffect(() => {
    if (locked) {
      setDialog(null);
      setShowHistory(false);
      setShowSetup(false);
    }
  }, [locked]);

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 3500);
  };

  const send = (op: RemoteOp, baseVersion?: number): Promise<boolean> =>
    replica.propose(op, baseVersion).then(
      () => true,
      (e: Error) => {
        flash(e.message);
        return false;
      },
    );

  const startMatch = (config: StartMatchConfig) => {
    void send({ kind: 'startMatch', config }).then((ok) => ok && setShowSetup(false));
  };

  if (pairing) {
    return (
      <div className="fixed inset-0 overflow-y-auto bg-slate-950 text-slate-50 font-sans">
        <RemotePairing
          initialOffer={initialOffer}
          onConnected={(t) => {
            connect(t);
            setPairing(false);
          }}
        />
      </div>
    );
  }

  const editing = dialog?.kind === 'edit' && state ? state.log.find((l) => l.ai === dialog.actionIndex) : null;

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950 text-slate-50 font-sans overflow-hidden">
      <div className="flex items-start gap-2 pr-3">
        <div className="flex-1 min-w-0">
          <RemoteStatusBar status={status} onReconnect={() => setPairing(true)} onCalibration={() => setShowCal(true)} />
        </div>
        <div className="pt-2">
          <FullscreenToggle />
        </div>
      </div>

      {state ? (
        <RemoteScoreboard
          state={state}
          locked={locked}
          onEditDart={(ai) => setDialog({ kind: 'edit', actionIndex: ai, version: replica.version })}
          onAddDart={() => setDialog({ kind: 'add', version: replica.version })}
          onUndo={() => {
            const last = state.log[state.log.length - 1];
            setDialog({
              kind: 'undo',
              version: replica.version,
              text: last ? `Ångra senaste: ${segLabel(last.dart)} (${last.playerName})?` : 'Ångra senaste?',
            });
          }}
          onEndTurn={() => {
            const next = state.players[(state.currentIndex + 1) % state.players.length];
            setDialog({
              kind: 'endTurn',
              text: `Avsluta ${state.active.name}s tur${next ? ` – ${next.name} kastar` : ''}?`,
            });
          }}
          onHistory={() => setShowHistory(true)}
          onNewMatch={() => (state.finished ? setShowSetup(true) : setDialog({ kind: 'newMatch' }))}
          onPlayAgain={() => {
            const c = configOf(state);
            if (c) startMatch(c);
          }}
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center text-2xl text-slate-400">
          Ingen match pågår.
          <button
            disabled={locked}
            onClick={() => setShowSetup(true)}
            className="px-6 py-3 rounded-2xl bg-blue-600 disabled:opacity-40 text-white font-black text-xl"
          >
            Starta en match
          </button>
        </div>
      )}

      {showSetup && (
        <GameSetup
          initial={configOf(state)}
          onStart={(opts) =>
            startMatch({
              mode: opts.mode,
              doubleOut: !!opts.doubleOut,
              farfarCap: !!opts.farfarCap,
              players: opts.players.map((p) => ({ name: p.name })),
            })
          }
          onSkip={() => setShowSetup(false)}
        />
      )}

      {dialog?.kind === 'newMatch' && (
        <div className="absolute inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-5 flex flex-col gap-4">
            <p className="text-xl font-bold text-white text-center">
              Avsluta matchen och starta en ny? Ställningen i den här matchen sparas inte.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setDialog(null)} className="py-3 rounded-2xl bg-slate-800 text-slate-200 font-bold">
                Avbryt
              </button>
              <button
                onClick={() => {
                  setDialog(null);
                  setShowSetup(true);
                }}
                className="py-3 rounded-2xl bg-blue-600 text-white font-black"
              >
                Ny match
              </button>
            </div>
          </div>
        </div>
      )}

      {showCal && (
        <RemoteCalibration
          hostState={hostState}
          preview={replica.preview}
          locked={locked}
          onAction={(action) => void send({ kind: 'calibrate', action })}
          onClose={() => setShowCal(false)}
        />
      )}

      {hostState?.confirmEmpty && (
        <RemoteConfirmEmpty locked={locked} onConfirm={() => void send({ kind: 'confirmEmpty' })} />
      )}

      {toast && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[60] max-w-[90vw] bg-red-900/95 border border-red-600 text-white font-bold px-5 py-3 rounded-2xl shadow-2xl text-center">
          {toast}
        </div>
      )}

      {editing && dialog?.kind === 'edit' && (
        <ThrowEditor
          current={editing.dart}
          suggestions={editing.alt}
          onApply={(seg) => {
            send({ kind: 'replace', actionIndex: dialog.actionIndex, seg }, dialog.version);
            setDialog(null);
          }}
          onDelete={() => {
            send({ kind: 'remove', actionIndex: dialog.actionIndex }, dialog.version);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'add' && (
        <ThrowEditor
          current={null}
          onApply={(seg) => {
            // Sist i listan, som telefonens "+" - inget index, så en pil som
            // landat under tiden gör inte förslaget ogiltigt.
            send({ kind: 'throw', seg });
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {(dialog?.kind === 'undo' || dialog?.kind === 'endTurn') && (
        <div className="absolute inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-5 flex flex-col gap-4">
            <p className="text-xl font-bold text-white text-center">{dialog.text}</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setDialog(null)} className="py-3 rounded-2xl bg-slate-800 text-slate-200 font-bold">
                Avbryt
              </button>
              <button
                onClick={() => {
                  if (dialog.kind === 'undo') send({ kind: 'undo' }, dialog.version);
                  else send({ kind: 'endTurn' });
                  setDialog(null);
                }}
                className="py-3 rounded-2xl bg-blue-600 text-white font-black"
              >
                {dialog.kind === 'undo' ? 'Ångra' : 'Avsluta tur'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistory && state && (
        <TurnHistory
          match={state}
          onEditorOpen={() => {
            historyVersionRef.current = replica.version;
          }}
          onEditThrow={(ai, seg) => send({ kind: 'replace', actionIndex: ai, seg }, historyVersionRef.current ?? undefined)}
          onDeleteThrow={(ai) => send({ kind: 'remove', actionIndex: ai }, historyVersionRef.current ?? undefined)}
          onInsertThrow={(ai, seg) => send({ kind: 'insert', actionIndex: ai, seg }, historyVersionRef.current ?? undefined)}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
