/**
 * Parkopplingskoden: en WebRTC-beskrivning (SDP) packad så liten att den
 * ryms i en QR-kod som en mobilkamera läser utan krångel.
 *
 * Utan server finns ingen annan väg för erbjudande och svar än att visa dem
 * för den andra enheten. Varje tecken gör QR-koden tätare, så tre steg:
 * 1. Minifiera: bara de rader en datakanal behöver (se KEEP). Kandidaterna
 *    kortas till det obligatoriska, och TCP-kandidater stryks - Chrome tar med
 *    "tcptype active" med port 9, som aldrig kan ta emot något på ett LAN.
 * 2. `CompressionStream('deflate-raw')` (Chrome, Safari 16.4+, Firefox, Node).
 * 3. base64url, så att koden går att klistra in och ligga i en URL-fragment.
 *
 * Format: `<roll><packning><data>`. Roll 'A' = erbjudande (från kameran),
 * 'B' = svar (från fjärrskärmen); packning 'z' = deflate-raw, 'p' = okomprimerad
 * (webbläsare utan CompressionStream). Rollbokstaven gör att ett felinklistrat
 * eget erbjudande ger ett begripligt fel i stället för ett tyst misslyckande.
 */

export type SignalKind = 'offer' | 'answer';

export interface Signal {
  kind: SignalKind;
  sdp: string;
}

/** Radprefix som behålls. Allt annat (BUNDLE, extmap, msid, ice-options...) behövs inte för en ensam datakanal. */
const KEEP = [
  'v=',
  'o=',
  's=',
  't=',
  'm=',
  'c=',
  'a=ice-ufrag:',
  'a=ice-pwd:',
  'a=fingerprint:',
  'a=setup:',
  'a=mid:',
  'a=sctp-port:',
  'a=max-message-size:',
  'a=candidate:',
  'a=end-of-candidates',
];

/**
 * `a=candidate:<foundation> <komponent> <transport> <prioritet> <adress> <port> typ <typ> [tillägg...]`
 * Tilläggen (generation, network-id, network-cost, ufrag) är frivilliga enligt
 * RFC 8839 och tar plats; de stryks.
 */
function shortenCandidate(line: string): string | null {
  const parts = line.slice('a=candidate:'.length).split(' ');
  if (parts.length < 8 || parts[6] !== 'typ') return line;
  if (parts[2].toLowerCase() !== 'udp') return null;
  return 'a=candidate:' + parts.slice(0, 8).join(' ');
}

export function minifySdp(sdp: string): string {
  const out: string[] = [];
  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !KEEP.some((k) => line.startsWith(k))) continue;
    if (line.startsWith('a=candidate:')) {
      const c = shortenCandidate(line);
      if (c) out.push(c);
    } else {
      out.push(line);
    }
  }
  // SDP kräver CRLF och en avslutande radbrytning.
  return out.join('\r\n') + '\r\n';
}

/* --- base64url ------------------------------------------------------------ */

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const canCompress = (): boolean =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/* --- kod ------------------------------------------------------------------ */

export async function encodeSignal(sig: Signal, opts: { compress?: boolean } = {}): Promise<string> {
  const role = sig.kind === 'offer' ? 'A' : 'B';
  const bytes = new TextEncoder().encode(minifySdp(sig.sdp));
  if ((opts.compress ?? true) && canCompress()) {
    return role + 'z' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
  }
  return role + 'p' + toBase64Url(bytes);
}

/**
 * Plockar ut koden ur vad som helst användaren klistrat in eller kameran
 * läst: själva koden, eller en adress med koden efter '#' (QR-kod A är en
 * länk, så att surfplattans vanliga kamera-app kan öppna fjärrskärmen direkt).
 */
export function extractCode(input: string): string {
  const s = input.trim();
  const hash = s.indexOf('#');
  return (hash >= 0 ? s.slice(hash + 1) : s).replace(/\s+/g, '');
}

export class SignalError extends Error {}

export async function decodeSignal(input: string, expect?: SignalKind): Promise<Signal> {
  const code = extractCode(input);
  const role = code[0];
  const packing = code[1];
  const kind: SignalKind | null = role === 'A' ? 'offer' : role === 'B' ? 'answer' : null;
  if (!kind || (packing !== 'z' && packing !== 'p') || code.length < 20) {
    throw new SignalError('Det där är ingen parkopplingskod.');
  }
  if (expect && kind !== expect) {
    throw new SignalError(
      expect === 'answer'
        ? 'Det är kamerans egen kod. Läs koden som fjärrskärmen visar.'
        : 'Det är fjärrskärmens svar. Läs koden som kameran visar.',
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(code.slice(2));
    if (packing === 'z') {
      if (!canCompress()) throw new SignalError('Webbläsaren kan inte packa upp koden. Uppdatera den.');
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
  } catch (e) {
    if (e instanceof SignalError) throw e;
    throw new SignalError('Koden är trasig eller ofullständig.');
  }
  const sdp = new TextDecoder().decode(bytes);
  if (!sdp.startsWith('v=0')) throw new SignalError('Koden är trasig eller ofullständig.');
  return { kind, sdp };
}
