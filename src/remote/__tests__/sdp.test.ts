import { describe, it, expect } from 'vitest';
import qrcode from 'qrcode-generator';
import { decodeSignal, encodeSignal, extractCode, minifySdp, SignalError } from '../sdp';

/**
 * Riktiga beskrivningar ur Chrome (headless, 2026-10-09): en förhandlad
 * datakanal utan iceServers, efter komplett ICE-insamling. Erbjudandet med
 * flera kandidater motsvarar en telefon med både IPv4 och IPv6 samt Chromes
 * TCP-kandidater.
 */
const CHROME_OFFER = [
  'v=0',
  'o=- 1261764052168735741 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:149362073 1 udp 2113937151 179c5317-814f-42d1-b5b9-525c18dd1499.local 50438 typ host generation 0 network-cost 999',
  'a=ice-ufrag:fmR8',
  'a=ice-pwd:NIOaDEpBrUATD2oGowoZ+KAY',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 4A:73:19:9D:0A:98:06:35:DD:86:C6:5E:EB:0A:9B:D4:67:FB:AE:5F:93:CD:78:01:AA:3F:15:25:BA:2B:75:1F',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

const PHONE_OFFER = CHROME_OFFER.replace(
  /a=candidate:[^\r]*\r\n/,
  [
    'a=candidate:149362073 1 udp 2113937151 179c5317-814f-42d1-b5b9-525c18dd1499.local 50438 typ host generation 0 network-id 1 network-cost 10',
    'a=candidate:2999745851 1 udp 2113939711 0f1a1e2b-7c3d-4e5f-8a9b-0c1d2e3f4a5b.local 41872 typ host generation 0 network-id 2 network-cost 10',
    'a=candidate:3523153593 1 tcp 1518157311 179c5317-814f-42d1-b5b9-525c18dd1499.local 9 typ host tcptype active generation 0 network-id 1 network-cost 10',
    'a=candidate:4233069003 1 tcp 1518149375 0f1a1e2b-7c3d-4e5f-8a9b-0c1d2e3f4a5b.local 9 typ host tcptype active generation 0 network-id 2 network-cost 10',
    '',
  ].join('\r\n'),
);

describe('SDP-minifiering', () => {
  it('behåller det en datakanal behöver och stryker resten', () => {
    const min = minifySdp(CHROME_OFFER);
    for (const keep of ['v=0', 'm=application', 'c=IN IP4', 'a=ice-ufrag:fmR8', 'a=ice-pwd:', 'a=fingerprint:sha-256', 'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:']) {
      expect(min).toContain(keep);
    }
    for (const drop of ['a=group:BUNDLE', 'a=extmap-allow-mixed', 'a=msid-semantic', 'a=ice-options']) {
      expect(min).not.toContain(drop);
    }
    expect(min.endsWith('\r\n')).toBe(true);
    expect(min).not.toContain('\r\n\r\n');
  });

  it('kandidaterna kortas till det obligatoriska och TCP-kandidater stryks', () => {
    const min = minifySdp(PHONE_OFFER);
    const cands = min.split('\r\n').filter((l) => l.startsWith('a=candidate:'));
    expect(cands).toEqual([
      'a=candidate:149362073 1 udp 2113937151 179c5317-814f-42d1-b5b9-525c18dd1499.local 50438 typ host',
      'a=candidate:2999745851 1 udp 2113939711 0f1a1e2b-7c3d-4e5f-8a9b-0c1d2e3f4a5b.local 41872 typ host',
    ]);
  });

  it('är idempotent', () => {
    expect(minifySdp(minifySdp(PHONE_OFFER))).toBe(minifySdp(PHONE_OFFER));
  });
});

describe('parkopplingskoden', () => {
  it('rundgång med komprimering ger den minifierade beskrivningen tillbaka', async () => {
    for (const kind of ['offer', 'answer'] as const) {
      const code = await encodeSignal({ kind, sdp: PHONE_OFFER });
      expect(code.slice(0, 2)).toBe(kind === 'offer' ? 'Az' : 'Bz');
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      const back = await decodeSignal(code);
      expect(back).toEqual({ kind, sdp: minifySdp(PHONE_OFFER) });
    }
  });

  it('rundgång utan komprimering (webbläsare utan CompressionStream)', async () => {
    const code = await encodeSignal({ kind: 'answer', sdp: CHROME_OFFER }, { compress: false });
    expect(code.slice(0, 2)).toBe('Bp');
    expect((await decodeSignal(code)).sdp).toBe(minifySdp(CHROME_OFFER));
  });

  it('koden går att läsa ur en länk och ur text med radbrytningar', async () => {
    const code = await encodeSignal({ kind: 'offer', sdp: CHROME_OFFER });
    const link = `https://kps-dart-cam.netlify.app/?remote#${code}`;
    expect(extractCode(link)).toBe(code);
    expect((await decodeSignal(link)).kind).toBe('offer');
    const wrapped = code.replace(/(.{40})/g, '$1\n');
    expect((await decodeSignal(wrapped)).sdp).toBe(minifySdp(CHROME_OFFER));
  });

  it('fel roll, skräp och avklippt kod ger ett begripligt fel', async () => {
    const offer = await encodeSignal({ kind: 'offer', sdp: CHROME_OFFER });
    await expect(decodeSignal(offer, 'answer')).rejects.toThrow(/kamerans egen kod/);
    await expect(decodeSignal('hej hej hej hej hej hej')).rejects.toBeInstanceOf(SignalError);
    await expect(decodeSignal(offer.slice(0, offer.length / 2))).rejects.toBeInstanceOf(SignalError);
  });

  it('längderna ryms i en QR-kod som en mobilkamera läser', async () => {
    const one = await encodeSignal({ kind: 'offer', sdp: CHROME_OFFER });
    const phone = await encodeSignal({ kind: 'offer', sdp: PHONE_OFFER });
    const link = `https://kps-dart-cam.netlify.app/?remote#${phone}`;
    // Mätt 2026-10-09: se CLAUDE.md. Gränserna är satta med marginal så att
    // testet säger till om minifieringen slutar verka, inte vid varje byte.
    expect(one.length).toBeLessThan(600);
    expect(phone.length).toBeLessThan(700);
    const qr = qrcode(0, 'L');
    qr.addData(link, 'Byte');
    qr.make();
    // Version 17 = 85x85 moduler. Större än så blir svårläst på en telefonskärm.
    expect(qr.getModuleCount()).toBeLessThanOrEqual(85);
    console.log(
      `kodlängd: en kandidat ${one.length}, telefon ${phone.length}, länk ${link.length} tecken, ` +
        `QR ${qr.getModuleCount()}x${qr.getModuleCount()} moduler; minifierad SDP ${minifySdp(PHONE_OFFER).length} av ${PHONE_OFFER.length} tecken`,
    );
  });
});
