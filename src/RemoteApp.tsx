import { useState } from 'react';
import { RemotePairing } from './components/remote/RemotePairing';
import { useRemoteReplica } from './hooks/useRemoteReplica';

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

/**
 * Fjärrskärmen (?remote). Laddar aldrig kameran, OpenCV eller detektorn -
 * den importerar inget av det, och main.tsx väljer den här komponenten i
 * stället för App innan något av det hunnit laddas.
 */
export default function RemoteApp() {
  const [initialOffer] = useState(initialOfferOnce);
  const { replica, connect } = useRemoteReplica();
  const [pairing, setPairing] = useState(() => initialOffer !== null || replica.match === null);
  const state = replica.state;

  return (
    <div className="fixed inset-0 overflow-y-auto bg-slate-950 text-slate-50 font-sans">
      {pairing ? (
        <RemotePairing
          initialOffer={initialOffer}
          onConnected={(t) => {
            connect(t);
            setPairing(false);
          }}
        />
      ) : (
        <div className="p-4 flex flex-col gap-3 max-w-md mx-auto">
          <p className="text-sm text-slate-400">
            {replica.connected ? 'Ansluten till kameran.' : 'Frånkopplad – visar senast kända läge.'}
          </p>
          {state ? (
            <p className="text-3xl font-black">
              {state.active.name}: {state.mode === 'FARFAR' ? `${state.view.total} / ${state.view.target}` : state.view.remaining}
            </p>
          ) : (
            <p className="text-slate-400">Ingen match pågår.</p>
          )}
          {!replica.connected && (
            <button onClick={() => setPairing(true)} className="py-3 rounded-xl bg-blue-600 text-white font-bold">
              Anslut igen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
