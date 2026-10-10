import { useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';

const displayFullscreen = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(display-mode: fullscreen)').matches;

/**
 * Helskärm för fjärrskärmen: en surfplatta som resultattavla vid tavlan ska
 * inte ha adressfält och statusrad (Kristian 2026-10-09). Döljs där API:t
 * saknas (iPhone-Safari), och när appen redan körs i helskärm för att den
 * installerats på hemskärmen (manifest-remote.webmanifest, display
 * fullscreen) - där finns inget att växla.
 */
export function FullscreenToggle() {
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const [active, setActive] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  const [installedFullscreen, setInstalledFullscreen] = useState(displayFullscreen);

  useEffect(() => {
    if (!supported) return;
    const onChange = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    const mq = window.matchMedia?.('(display-mode: fullscreen)');
    const onMq = () => setInstalledFullscreen(displayFullscreen());
    mq?.addEventListener?.('change', onMq);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      mq?.removeEventListener?.('change', onMq);
    };
  }, [supported]);

  if (!supported || (installedFullscreen && !active)) return null;

  const toggle = () => {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    // Nekat (ingen användaraktivering, policy): inget att göra, knappen står kvar.
    void p?.catch(() => {});
  };

  return (
    <button
      onClick={toggle}
      aria-label={active ? 'Lämna helskärm' : 'Helskärm'}
      title={active ? 'Lämna helskärm' : 'Helskärm'}
      className="shrink-0 p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
    >
      {active ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
    </button>
  );
}
