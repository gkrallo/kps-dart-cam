import { useState } from 'react';
import { Copy, Share2, ClipboardPaste } from 'lucide-react';

/**
 * Reservvägen när QR-skanningen strular, eller när den ena enheten saknar
 * kamera (en laptop): samma kod som text, att kopiera, dela eller klistra in.
 */
export function CodeShare({ code, shareTitle }: { code: string; shareTitle: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Urklipp kräver ibland en användaraktivering som inte räknas här -
      // markera texten så att den går att kopiera för hand.
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <textarea
        readOnly
        value={code}
        onFocus={(e) => e.currentTarget.select()}
        rows={3}
        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-[10px] font-mono text-slate-400 break-all resize-none"
        aria-label="Parkopplingskod"
      />
      <div className="flex gap-2">
        <button
          onClick={() => void copy()}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
        >
          <Copy className="w-3.5 h-3.5" /> {copied ? 'Kopierad' : 'Kopiera'}
        </button>
        {canShare && (
          <button
            onClick={() => void navigator.share({ title: shareTitle, text: code }).catch(() => {})}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
          >
            <Share2 className="w-3.5 h-3.5" /> Dela
          </button>
        )}
      </div>
    </div>
  );
}

export function CodePaste({
  onSubmit,
  label,
  busy = false,
}: {
  onSubmit: (code: string) => void;
  label: string;
  busy?: boolean;
}) {
  const [text, setText] = useState('');
  return (
    <div className="flex flex-col gap-2 w-full">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Klistra in koden här"
        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-[11px] font-mono text-slate-200 break-all resize-none"
        aria-label={label}
      />
      <button
        disabled={busy || text.trim().length < 20}
        onClick={() => onSubmit(text)}
        className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold"
      >
        <ClipboardPaste className="w-3.5 h-3.5" /> {label}
      </button>
    </div>
  );
}
