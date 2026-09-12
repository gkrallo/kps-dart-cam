import { X, Crosshair, Ear, HandMetal, Pencil, Eye, AlertTriangle } from 'lucide-react';

interface Props {
  onClose: () => void;
}

interface Section {
  icon: typeof Crosshair;
  title: string;
  body: string;
}

const SECTIONS: Section[] = [
  {
    icon: Crosshair,
    title: 'Kalibrering',
    body:
      'Dra de fyra punkterna till dubbelringens ytterkant vid 20 (topp), 6 (höger), 3 (botten) och 11 (vänster). Sikta tripoden mot bullseye och tryck "Sikte" för att zooma in automatiskt först, eller använd "Auto-Kalibrera" för att hitta ringarna själv.',
  },
  {
    icon: Ear,
    title: 'Automatisk avläsning',
    body:
      'Kameran läser av när en pil landar och blivit stilla. Varje pil läses upp direkt, och efter en hel tur hörs summan och den nya ställningen. Rör dig inte i bild när en pil precis kastats - då hinner tavlan inte lugna ner sig.',
  },
  {
    icon: HandMetal,
    title: 'Hämta pilar - i omvänd ordning',
    body:
      'Dra ut den sist kastade pilen först, en i taget, med en kort paus mellan varje. Sitter en pil dold bakom en annan (osynlig för kameran) avslöjas den då automatiskt när pilen ovanpå tas bort, i stället för att aldrig räknas. Ryck inte ut alla tre på en gång om du kan undvika det.',
  },
  {
    icon: Pencil,
    title: 'Rätta ett kast',
    body:
      'Blev en pil fel avläst? Tryck på den i pilraden för att välja rätt fält. Under "Turer" nås även tidigare turer – där går det att rätta, ta bort och lägga till en pil som missades, på rätt plats i turen. Ställningen räknas om från kastlistan, så allt kan rättas i efterhand. "Ångra" tar bort det allra senaste kastet.',
  },
  {
    icon: AlertTriangle,
    title: 'Om appen missar en pil',
    body:
      'Avslutas en tur med färre avlästa pilar än du kastade säger appen till, både på skärmen och högt. Tryck "Lägg till" för att fylla i den som saknas. Ett vanligt skäl är att två pilar hamnat så tätt att kameran bara ser en.',
  },
  {
    icon: Eye,
    title: 'Vision-vyn',
    body:
      'Visar vad datorseendet faktiskt ser: tavlans ringar och var det tror att pilarna suttit. Bra för att felsöka en dålig kalibrering eller förstå varför en pil lästes fel.',
  },
];

/**
 * Hjälppanel med de knep som annars bara finns i huvudet på en. Öppnas via
 * "?"-knappen i headern. Se även RetrievalTip - samma "omvänd uttagning"-tips
 * visas där automatiskt en gång, det här är referensen man kan slå upp igen.
 */
export function HelpPanel({ onClose }: Props) {
  return (
    <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-sm flex flex-col p-4 overflow-y-auto">
      <div className="w-full max-w-md mx-auto flex flex-col gap-3 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-white">Hjälp och tips</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white" aria-label="Stäng">
            <X className="w-5 h-5" />
          </button>
        </div>

        {SECTIONS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex gap-3">
            <Icon className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-white mb-1">{title}</h3>
              <p className="text-xs text-slate-300 leading-snug">{body}</p>
            </div>
          </div>
        ))}

        <button
          onClick={onClose}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-sm mt-1"
        >
          Stäng
        </button>
      </div>
    </div>
  );
}
