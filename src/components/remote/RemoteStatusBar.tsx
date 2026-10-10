import { Wifi, WifiOff, Crosshair } from 'lucide-react';

export type RemoteStatus =
  | { kind: 'connected' }
  /** Kanalen är öppen men kameran har inte svarat på en stund (wifiglapp). */
  | { kind: 'silent'; since: number | null }
  | { kind: 'disconnected'; since: number | null };

const clock = (ms: number | null) =>
  ms === null ? '' : new Date(ms).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

/**
 * Anslutningen syns alltid men tar lite plats. Frånkopplad är inget fel som
 * stoppar något - resultattavlan står kvar - men rättning är låst, och det
 * ska gå att se varför.
 */
export function RemoteStatusBar({
  status,
  onReconnect,
  onCalibration,
}: {
  status: RemoteStatus;
  onReconnect: () => void;
  /** Öppna kalibreringsvyn. Bara när kameran hörs - annars finns inget att styra. */
  onCalibration?: () => void;
}) {
  if (status.kind === 'connected') {
    return (
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
          <Wifi className="w-3.5 h-3.5" /> Ansluten till kameran
        </span>
        {onCalibration && (
          <button
            onClick={onCalibration}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold"
          >
            <Crosshair className="w-3.5 h-3.5 text-amber-400" /> Kalibrering
          </button>
        )}
      </div>
    );
  }
  const silent = status.kind === 'silent';
  return (
    <div
      className={`flex items-center justify-between gap-2 mx-4 mt-3 px-3 py-2 rounded-2xl border text-sm ${
        silent ? 'bg-amber-950/70 border-amber-800/60 text-amber-200' : 'bg-red-950/70 border-red-800/60 text-red-200'
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span className="truncate">
          {silent ? 'Ingen kontakt med kameran' : 'Frånkopplad – visar senast kända läge'}
          {status.since !== null && ` (${clock(status.since)})`}
        </span>
      </span>
      {!silent && (
        <button onClick={onReconnect} className="shrink-0 px-3 py-1 rounded-xl bg-blue-600 text-white font-bold text-xs">
          Anslut igen
        </button>
      )}
    </div>
  );
}
