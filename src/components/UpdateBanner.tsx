import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Registrerar service workern och säger till när en ny version ligger
 * nedladdad. Laddar ALDRIG om av sig själv: mitt i en leg ska spelaren välja
 * tidpunkten. Matchen är sparad, så en omladdning är ofarlig - men en
 * plötslig omstart av kameran mitt i ett kast är det inte.
 *
 * Raden är liten och ligger i överkant, eftersom ingen står vid telefonen
 * under spelet och ett stort kort skulle skymma kameravyn i onödan.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [dismissed, setDismissed] = useState(false);

  if (!needRefresh || dismissed) return null;

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] flex items-center gap-2 bg-slate-900/95 border border-slate-700 text-slate-200 text-xs rounded-full pl-3 pr-1 py-1 shadow-lg">
      <span className="truncate">Ny version finns – ladda om?</span>
      <button
        onClick={() => void updateServiceWorker(true)}
        className="bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full px-3 py-1"
      >
        Ladda om
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-slate-400 hover:text-white px-2 py-1"
        aria-label="Senare"
      >
        Senare
      </button>
    </div>
  );
}
