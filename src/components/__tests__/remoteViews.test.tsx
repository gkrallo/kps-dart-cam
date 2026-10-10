import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RemoteScoreboard } from '../remote/RemoteScoreboard';
import { RemoteStatusBar } from '../remote/RemoteStatusBar';
import { RemotePairing } from '../remote/RemotePairing';
import { QrCode } from '../remote/QrCode';
import { CodePaste, CodeShare } from '../remote/CodeTools';
import { TurnHistory } from '../TurnHistory';
import { GameSetup } from '../GameSetup';
import { createMatch, endTurn, matchState, throwDart } from '../../game/match';

/**
 * Rök-test för fjärrskärmens vyer, som gameViews.test.tsx: en renderpass
 * utan DOM. Fångar kraschar i renderträdet - fjärrskärmen körs på en annan
 * enhet än den man felsöker från, så ett vitt fönster där är dyrt.
 */

const noop = () => {};
const handlers = {
  onEditDart: noop,
  onAddDart: noop,
  onUndo: noop,
  onEndTurn: noop,
  onHistory: noop,
  onNewMatch: noop,
  onPlayAgain: noop,
};

describe('fjärrskärmens vyer renderar utan att krascha', () => {
  it('resultattavla, 501 mitt i en tur', () => {
    const m = createMatch({ mode: '501', players: [{ name: 'Kristian' }, { name: 'Anders' }] });
    throwDart(m, { v: 20, m: 3 }, { label: 'T20', rMM: 103, deg: 2, how: 'axel', alt: ['S20'] });
    throwDart(m, { v: 5, m: 1 });
    const html = renderToStaticMarkup(createElement(RemoteScoreboard, { state: matchState(m), locked: false, ...handlers }));
    expect(html).toContain('Kristian');
    expect(html).toContain('Anders');
    expect(html).toContain('436'); // 501 - 60 - 5
    expect(html).toContain('T20?'); // flaggad pil
    expect(html).toContain('Nästa spelare');
  });

  it('resultattavla, Farfar visar mål, runda och sparade pilar', () => {
    const m = createMatch({ mode: 'FARFAR', players: [{ name: 'Kristian' }, { name: 'Anders' }] });
    throwDart(m, { v: 3, m: 1 });
    const html = renderToStaticMarkup(createElement(RemoteScoreboard, { state: matchState(m), locked: false, ...handlers }));
    expect(html).toContain('Mål 15');
    expect(html).toContain('Runda 1');
    expect(html).toContain('sparade');
  });

  it('låst resultattavla har inaktiva knappar', () => {
    const m = createMatch({ mode: '301', players: [{ name: 'Kristian' }] });
    throwDart(m, { v: 20, m: 1 });
    const html = renderToStaticMarkup(createElement(RemoteScoreboard, { state: matchState(m), locked: true, ...handlers }));
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('avgjord match visar vinnaren', () => {
    const m = createMatch({ mode: '501', players: [{ name: 'Kristian' }] });
    endTurn(m);
    const st = { ...matchState(m), finished: true, winners: ['Kristian'] };
    const html = renderToStaticMarkup(createElement(RemoteScoreboard, { state: st, locked: false, ...handlers }));
    expect(html).toContain('vinner!');
    expect(html).toContain('Spela igen, samma spelare');
  });

  it('statusraden i alla tre lägen', () => {
    const r = (status: Parameters<typeof RemoteStatusBar>[0]['status']) =>
      renderToStaticMarkup(createElement(RemoteStatusBar, { status, onReconnect: noop }));
    expect(r({ kind: 'connected' })).toContain('Ansluten');
    expect(r({ kind: 'silent', since: Date.now() })).toContain('Ingen kontakt');
    const off = r({ kind: 'disconnected', since: new Date(2026, 9, 9, 21, 43).getTime() });
    expect(off).toContain('Frånkopplad – visar senast kända läge');
    expect(off).toContain('21:43');
    expect(off).toContain('Anslut igen');
  });

  it('parkopplingen börjar med skanna eller klistra in', () => {
    const html = renderToStaticMarkup(createElement(RemotePairing, { initialOffer: null, onConnected: noop }));
    expect(html).toContain('Skanna QR-kod');
    expect(html).toContain('Klistra in kod');
  });

  it('QR-kod, kopiera och klistra in', () => {
    const qr = renderToStaticMarkup(createElement(QrCode, { text: 'https://kps-dart-cam.netlify.app/?remote#Az' + 'x'.repeat(500) }));
    expect(qr).toContain('<svg');
    expect(qr).toContain('<path');
    expect(renderToStaticMarkup(createElement(CodeShare, { code: 'Bzabc', shareTitle: 't' }))).toContain('Kopiera');
    expect(renderToStaticMarkup(createElement(CodePaste, { label: 'Anslut', onSubmit: noop }))).toContain('Anslut');
  });

  it('Turer tar emot onEditorOpen utan att ändra utseendet', () => {
    const m = createMatch({ mode: '501', players: [{ name: 'Kristian' }] });
    throwDart(m, { v: 20, m: 3 });
    const props = { match: matchState(m), onEditThrow: noop, onDeleteThrow: noop, onInsertThrow: noop, onClose: noop };
    expect(renderToStaticMarkup(createElement(TurnHistory, { ...props, onEditorOpen: noop }))).toBe(
      renderToStaticMarkup(createElement(TurnHistory, props)),
    );
  });
  it('inställningarna förifylls med förra matchens upplägg', () => {
    const html = renderToStaticMarkup(
      createElement(GameSetup, {
        onStart: noop,
        initial: { mode: 'FARFAR', farfarCap: true, players: [{ name: 'Kristian' }, { name: 'Anders' }, { name: 'Lisa' }] },
      }),
    );
    expect(html).toContain('value="Kristian"');
    expect(html).toContain('value="Lisa"');
    expect(html).toContain('Tak på 100');
  });
});
