import { useCallback, useEffect, useRef, useState } from 'react';
import type { Match, MatchState } from '../game/types';
import { RemoteHost, type AppliedOp } from '../remote/host';
import type { HostCommand } from '../remote/protocol';
import { WebRtcTransport } from '../remote/webRtcTransport';

export interface PairingSession {
  /** Kod A: kamerans erbjudande, visas som QR-kod. */
  code: string;
  /** Tar emot fjärrskärmens svar (kod B). Kastar SignalError med svensk text. */
  acceptAnswer(code: string): Promise<void>;
  /** Löses när kanalen öppnats, avvisas om den stängs innan dess. */
  opened: Promise<void>;
  /** Avbryter en parkoppling som inte hunnit öppnas. En öppen kanal lämnas i fred. */
  cancel(): void;
}

/**
 * Kamerans sida av fjärrskärmen. En RemoteHost för hela appens livstid,
 * bunden till SAMMA Match-objekt som useMatch - det finns bara en sanning.
 *
 * Fjärrskärmar är ett tillägg: utan parkoppling skapas ingen WebRTC-
 * förbindelse alls, och en fjärrskärm som försvinner glöms bara bort.
 */
export interface RemoteHostHandlers {
  /** Ett förslag från en fjärrskärm har ändrat matchen. */
  onApplied: (a: AppliedOp) => void;
  /** Ett kommando till appen (ny match ...). null = utfört, annars skälet. */
  onCommand: (cmd: HostCommand, clientId: string) => string | null;
}

export function useRemoteHost(match: Match | null, state: MatchState | null, handlers: RemoteHostHandlers) {
  // I en ref av samma skäl som detektorns callbacks: de får ny identitet vid
  // varje kast, och värden ska inte byggas om för det.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const [clients, setClients] = useState<string[]>([]);
  const hostRef = useRef<RemoteHost | null>(null);
  if (hostRef.current === null) {
    hostRef.current = new RemoteHost(match, {
      onApplied: (a) => handlersRef.current.onApplied(a),
      onCommand: (cmd, clientId) => handlersRef.current.onCommand(cmd, clientId),
      onPeersChanged: setClients,
    });
  }
  const host = hostRef.current;

  // `state` byter identitet exakt när kastlistan ändrats (matchState räknar
  // om vid ny revision), och `match` när en match startas eller avslutas.
  // Anrop utan faktisk ändring ger ingen ny version, så en extra omritning
  // kostar bara en jämförelse.
  useEffect(() => {
    host.notifyChanged(match);
  }, [host, match, state]);

  const startPairing = useCallback(async (): Promise<PairingSession> => {
    const { transport, code } = await WebRtcTransport.createOffer();
    const detach = host.attach(transport);
    let opened = false;
    const openedPromise = new Promise<void>((resolve, reject) => {
      const off = transport.onStateChange((s) => {
        if (s === 'open') {
          opened = true;
          resolve();
          queueMicrotask(() => off());
        } else if (s === 'closed' && !opened) {
          reject(new Error('Förbindelsen stängdes innan den hann öppnas.'));
          queueMicrotask(() => off());
        }
      });
    });
    // Ingen ska behöva hantera ett avvisat löfte bara för att panelen stängdes.
    openedPromise.catch(() => {});
    return {
      code,
      acceptAnswer: (answer) => transport.acceptAnswer(answer),
      opened: openedPromise,
      cancel: () => {
        if (opened) return;
        detach();
        transport.close();
      },
    };
  }, [host]);

  return { clients, startPairing, host };
}
