/**
 * Gemensam CDP-koppling mot appen på telefonen.
 *
 * Telefonen ansluts över USB (utvecklarläge + USB-felsökning), och Chrome på
 * Android exponerar DevTools-protokollet över en lokal abstrakt socket. `adb
 * forward` gör den nåbar på 127.0.0.1:9222. Node 24 har en inbyggd WebSocket,
 * så inget npm-paket behövs - de här verktygen ska kunna köras utan att
 * installera något.
 *
 * Skälet att de finns i repot: de skrevs en gång under felsökningen i
 * september 2026, fungerade bra, och slängdes sedan. Att bygga om dem på plats
 * vid tavlan är slöseri med den enda tid då det faktiskt finns en tavla.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ADB_CANDIDATES = [
  process.env.ADB,
  'C:/Users/kristian.pettersson/AppData/Local/Android/sdk/platform-tools/adb.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Android/sdk/platform-tools/adb.exe`,
  'adb',
];

export function adbPath() {
  for (const c of ADB_CANDIDATES) {
    if (!c) continue;
    if (c === 'adb') return c; // finns i PATH, låt execFile avgöra
    if (existsSync(c)) return c;
  }
  throw new Error('Hittar inte adb. Sätt ADB=<sökväg till adb.exe> i miljön.');
}

export function adb(...args) {
  // stderr fångas i stället för att skickas vidare till vår egen: adb skriver
  // "daemon not running" och liknande brus som annars döljer vårt eget svar.
  return execFileSync(adbPath(), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Kör ett verktygs huvudkropp och skriver bara MENINGEN vid fel, inte en
 * stackdump. Vid tavlan är tiden dyr och stacken säger ingenting - felen här
 * är av sorten "ingen telefon", "fel flik", "kör utan ?debug".
 */
export async function main(fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`
${err?.message ?? err}
`);
    process.exitCode = 1;
  }
}

/** Ser till att telefonens DevTools är nåbar på 127.0.0.1:<port>. */
export function forward(port = 9222) {
  const devices = adb('devices')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim() && !l.includes('offline') && !l.includes('unauthorized'));
  if (devices.length === 0) {
    throw new Error(
      'Ingen telefon ansluten. Kontrollera USB-felsökning, och att du godkänt datorn på telefonen.',
    );
  }
  adb('forward', `tcp:${port}`, 'localabstract:chrome_devtools_remote');
  return port;
}

/**
 * Hittar appens flik.
 *
 * OBS: bara EN flik kan hålla kameran. Är flera öppna mot appen stjäl den
 * senast laddade strömmen tyst, och symptomet är svart bild med en ström som
 * påstår sig vara `live`. Därför varnar vi i stället för att gissa.
 */
export async function findAppTarget(port = 9222) {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const pages = list.filter(
    (t) =>
      t.type === 'page' &&
      /kps-dart-cam|localhost:5173/.test(t.url ?? '') &&
      !t.url.startsWith('devtools://'),
  );
  if (pages.length === 0) {
    const urls = list.filter((t) => t.type === 'page').map((t) => t.url);
    throw new Error(
      `Hittar ingen flik med appen. Öppna https://gkrallo.github.io/kps-dart-cam/ på telefonen.\nÖppna flikar: ${urls.join(', ') || '(inga)'}`,
    );
  }
  if (pages.length > 1) {
    console.warn(
      `VARNING: ${pages.length} flikar har appen öppen. Bara en får hålla kameran -\n` +
        'stäng de andra, annars blir bilden svart utan felmeddelande:\n' +
        pages.map((p) => `  ${p.id}  ${p.url}`).join('\n') +
        `\nStäng med: curl http://127.0.0.1:${port}/json/close/<id>\n`,
    );
  }
  return pages[0];
}

/** Öppen CDP-session mot en flik. */
export class Session {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    /** Millisekunden vi kopplade upp. Se kommentaren i `on`. */
    this.connectedAt = Date.now();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`Timeout på ${method}`));
      }, 30000);
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Kör JS i sidan och returnerar värdet. */
  async evaluate(expression, { awaitPromise = true } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      timeout: 20000,
    });
    if (res.exceptionDetails) {
      throw new Error(
        `Fel i sidan: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`,
      );
    }
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

export async function connect({ port = 9222 } = {}) {
  forward(port);
  const target = await findAppTarget(port);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket vägrade ansluta')), {
      once: true,
    });
  });
  const session = new Session(ws);
  return { session, target };
}

/** Vilket bygge som faktiskt är laddat - hashen ändras vid varje deploy. */
export async function loadedBundle(session) {
  return session.evaluate(`
    (() => {
      const s = [...document.querySelectorAll('script[src]')]
        .map(e => e.src.match(/index-[A-Za-z0-9_-]+\\.js/)?.[0])
        .filter(Boolean);
      return s[0] ?? 'okänt';
    })()
  `);
}
