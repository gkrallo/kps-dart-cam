import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

interface Props {
  text: string;
  /** Största sida i px; koden skalas ner på smala skärmar. */
  size?: number;
}

/**
 * QR-kod som SVG. Felkorrigering L: koden visas på en skärm, inte tryckt på
 * en tavla som slits, och L ger flest tecken per modul - en tätare kod är
 * svårare för en mobilkamera än en lite mindre robust.
 */
export function QrCode({ text, size = 320 }: Props) {
  const { path, n } = useMemo(() => {
    const qr = qrcode(0, 'L');
    qr.addData(text, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { path: d, n: count };
  }, [text]);

  // Fyra moduler tyst zon runt om, som standarden kräver - utan den hittar
  // läsaren inte hörnmarkeringarna mot en mörk bakgrund.
  const quiet = 4;
  const total = n + quiet * 2;
  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${total} ${total}`}
      width={size}
      height={size}
      className="max-w-full h-auto rounded-lg"
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR-kod för parkoppling"
    >
      <rect x={-quiet} y={-quiet} width={total} height={total} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
