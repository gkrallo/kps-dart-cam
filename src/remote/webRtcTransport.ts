import { decodeMessage, encodeMessage, type WireMessage } from './protocol';
import { decodeSignal, encodeSignal } from './sdp';
import type { Transport, TransportState } from './transport';

/**
 * Transport över en WebRTC-datakanal - det enda sättet för en sida på HTTPS
 * att prata direkt med en annan enhet på samma LAN utan server (ws:// och
 * http:// mot en LAN-adress blockeras som blandat innehåll).
 *
 * - Inga `iceServers`: bara enhetens egna adresser (host-kandidater). På samma
 *   wifi räcker det, och det är det enda som inte kräver en tjänst utanför.
 *   Chrome och Safari döljer adresserna bakom mDNS-namn (*.local) för sidor
 *   utan kamerabehörighet - se unlockHostCandidates för varför fjärrsidan
 *   ändå ber om kameran.
 * - Ingen trickle: vi väntar tills alla kandidater samlats innan beskrivningen
 *   tas ut, så att allt ryms i EN QR-kod åt vardera hållet.
 * - Kanalen är förhandlad i förväg (`negotiated`, id 0) på båda sidor, så
 *   ingen `ondatachannel`-dans behövs.
 */

const RTC_CONFIG: RTCConfiguration = { iceServers: [] };
const CHANNEL_LABEL = 'kps';
/** Utan STUN är insamlingen klar på millisekunder, men Chrome kan dröja på en enhet med många nätgränssnitt. */
const GATHER_TIMEOUT_MS = 4000;

function waitForGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    pc.addEventListener('icegatheringstatechange', check);
    // Hellre en kod med de kandidater som hunnit komma än ingen kod alls.
    const timer = setTimeout(done, GATHER_TIMEOUT_MS);
  });
}

/**
 * Ber om kameran ett ögonblick innan svaret skapas, och släpper den direkt.
 *
 * Uppmätt 2026-10-09 (Galaxy S25 + Samsung-surfplatta, samma wifi):
 * parkopplingen gick igenom åt båda hållen men kanalen kom aldrig upp. En
 * sida UTAN kamerabehörighet döljer sina adresser bakom slumpade *.local-
 * namn, och de måste slås upp med multicast-DNS - som många hemrouter och
 * Android-enheter inte släpper fram. Kameraenheten har behörighet och visar
 * sin riktiga adress; fjärrsidan hade det inte. Med beviljad behörighet
 * lägger Chrome riktiga adresser i kandidaterna. Nekas frågan fortsätter vi
 * ändå - på vissa nät räcker mDNS.
 */
async function unlockHostCandidates(): Promise<void> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    /* nekad eller ingen kamera - försök med mDNS-namnen */
  }
}

export class WebRtcTransport implements Transport {
  private state: TransportState = 'connecting';
  private messageCbs = new Set<(msg: WireMessage) => void>();
  private stateCbs = new Set<(s: TransportState) => void>();
  private readonly channel: RTCDataChannel;

  private constructor(private readonly pc: RTCPeerConnection) {
    this.channel = pc.createDataChannel(CHANNEL_LABEL, { negotiated: true, id: 0, ordered: true });
    this.channel.onopen = () => this.setState('open');
    this.channel.onclose = () => this.setState('closed');
    this.channel.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      const msg = decodeMessage(ev.data);
      if (!msg) return;
      this.messageCbs.forEach((cb) => {
        try {
          cb(msg);
        } catch (err) {
          // En trasig mottagare får inte tysta kanalen för de andra.
          console.error('Fjärrskärm: fel vid hantering av meddelande', err);
        }
      });
    };
    // 'disconnected' kan gå över av sig själv (kort wifiglapp); 'failed'
    // och 'closed' gör det inte - då är parkopplingen förbrukad.
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.setState('closed');
    };
  }

  /** Kamerans sida: skapar erbjudandet. Koden visas som QR-kod A. */
  static async createOffer(): Promise<{ transport: WebRtcTransport; code: string }> {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const t = new WebRtcTransport(pc);
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitForGathering(pc);
      const code = await encodeSignal({ kind: 'offer', sdp: pc.localDescription!.sdp });
      return { transport: t, code };
    } catch (e) {
      t.close();
      throw e;
    }
  }

  /** Fjärrskärmens sida: tar emot erbjudandet och skapar svaret (QR-kod B). */
  static async acceptOffer(offerCode: string): Promise<{ transport: WebRtcTransport; code: string }> {
    const offer = await decodeSignal(offerCode, 'offer');
    await unlockHostCandidates();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const t = new WebRtcTransport(pc);
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForGathering(pc);
      const code = await encodeSignal({ kind: 'answer', sdp: pc.localDescription!.sdp });
      return { transport: t, code };
    } catch (e) {
      t.close();
      throw e;
    }
  }

  /** Kamerans sida: tar emot svaret. Kanalen öppnas strax efteråt. */
  async acceptAnswer(answerCode: string): Promise<void> {
    const answer = await decodeSignal(answerCode, 'answer');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
  }

  get currentState(): TransportState {
    return this.state;
  }

  send(msg: WireMessage): void {
    if (this.channel.readyState !== 'open') return;
    try {
      // Serialiseras här och nu - se kravet i Transport.
      this.channel.send(encodeMessage(msg));
    } catch (err) {
      // Full sändbuffert eller en kanal som just stängs: tappa meddelandet.
      // Nästa ögonblicksbild bär ändå hela matchen.
      console.error('Fjärrskärm: kunde inte skicka', err);
    }
  }

  onMessage(cb: (msg: WireMessage) => void): () => void {
    this.messageCbs.add(cb);
    return () => this.messageCbs.delete(cb);
  }

  onStateChange(cb: (s: TransportState) => void): () => void {
    this.stateCbs.add(cb);
    cb(this.state);
    return () => this.stateCbs.delete(cb);
  }

  close(): void {
    try {
      this.channel.close();
      this.pc.close();
    } catch {
      /* redan stängd */
    }
    this.setState('closed');
  }

  private setState(s: TransportState): void {
    if (this.state === s || this.state === 'closed') return;
    this.state = s;
    this.stateCbs.forEach((cb) => cb(s));
  }
}
