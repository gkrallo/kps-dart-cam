import { describe, it, expect } from 'vitest';
import { createElement, type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameSetup } from '../GameSetup';
import { Scoreboard } from '../Scoreboard';
import { ThrowEditor } from '../ThrowEditor';
import { TurnHistory } from '../TurnHistory';
import { HelpPanel } from '../HelpPanel';
import { createMatch, matchState, throwDart, endTurn } from '../../game/match';

/**
 * Rök-test: en renderpass utan att krascha. Ingen DOM behövs
 * (renderToStaticMarkup), men det fångar felaktiga hooks och odefinierade
 * uppslag i renderträdet - vilket den stora omskrivningen till spellägen
 * annars bara syns på telefonen.
 */

const noop = () => {};
const canvasRef = { current: null } as RefObject<HTMLCanvasElement | null>;

describe('spelvyer renderar utan att krascha', () => {
  it('GameSetup', () => {
    const html = renderToStaticMarkup(createElement(GameSetup, { onStart: noop }));
    expect(html).toContain('Farfar');
    expect(html).toContain('Starta spel');
  });

  it('ThrowEditor', () => {
    const html = renderToStaticMarkup(
      createElement(ThrowEditor, { current: { v: 20, m: 3 }, onApply: noop, onClose: noop }),
    );
    expect(html).toContain('T20');
  });

  it('Scoreboard - inget spel', () => {
    const html = renderToStaticMarkup(
      createElement(Scoreboard, {
        match: null,
        hasEndTurn: true,
        onUndo: noop,
        onFinishTurn: noop,
        onEditThrow: noop,
        onDeleteThrow: noop,
        onNewGame: noop,
        isCalibrated: true,
        onCalibrateClick: noop,
        detectorState: 'STABLE',
        motionThreshold: 3000,
        onThresholdChange: noop,
        debugCanvasRef: canvasRef,
      }),
    );
    expect(html).toBe('');
  });

  it('Scoreboard - pågående 501-spel med kast', () => {
    const m = createMatch({ mode: '501', players: [{ name: 'Anna' }, { name: 'Bo' }] });
    throwDart(m, { v: 20, m: 3 });
    throwDart(m, { v: 5, m: 1 });
    const html = renderToStaticMarkup(
      createElement(Scoreboard, {
        match: matchState(m),
        hasEndTurn: true,
        onUndo: noop,
        onFinishTurn: noop,
        onEditThrow: noop,
        onDeleteThrow: noop,
        onNewGame: noop,
        isCalibrated: true,
        onCalibrateClick: noop,
        detectorState: 'ANALYZING',
        motionThreshold: 3000,
        onThresholdChange: noop,
        debugCanvasRef: canvasRef,
        viewMode: 'live',
      }),
    );
    expect(html).toContain('Anna');
    expect(html).toContain('T20');
    expect(html).toContain('436'); // live: 501 - 60 - 5
  });

  it('Scoreboard - Farfar', () => {
    const m = createMatch({ mode: 'FARFAR', players: [{ name: 'Anna' }, { name: 'Bo' }] });
    throwDart(m, { v: 3, m: 1 });
    const html = renderToStaticMarkup(
      createElement(Scoreboard, {
        match: matchState(m),
        hasEndTurn: false,
        onUndo: noop,
        onFinishTurn: noop,
        onEditThrow: noop,
        onDeleteThrow: noop,
        onNewGame: noop,
        isCalibrated: true,
        onCalibrateClick: noop,
        detectorState: 'STABLE',
        motionThreshold: 3000,
        onThresholdChange: noop,
        debugCanvasRef: canvasRef,
      }),
    );
    expect(html).toContain('Runda 1');
    expect(html).toContain('/ 15'); // mål runda 1
  });

  it('Scoreboard - varning när färre pilar lästes av än turen rymmer', () => {
    const m = createMatch({ mode: '501', players: [{ name: 'Anna' }] });
    throwDart(m, { v: 20, m: 1 });
    const html = renderToStaticMarkup(
      createElement(Scoreboard, {
        match: matchState(m),
        hasEndTurn: true,
        onUndo: noop,
        onFinishTurn: noop,
        onEditThrow: noop,
        onDeleteThrow: noop,
        onNewGame: noop,
        isCalibrated: true,
        onCalibrateClick: noop,
        detectorState: 'CLEARED',
        motionThreshold: 3000,
        onThresholdChange: noop,
        debugCanvasRef: canvasRef,
        missedDarts: { playerName: 'Anna', read: 2, expected: 3 },
        onHistoryClick: noop,
      }),
    );
    expect(html).toContain('2 av 3 pilar');
    expect(html).toContain('Lägg till');
  });

  it('HelpPanel', () => {
    const html = renderToStaticMarkup(createElement(HelpPanel, { onClose: noop }));
    expect(html).toContain('omvänd ordning');
  });

  it('TurnHistory - grupperar kast i turer över flera spelare', () => {
    const m = createMatch({ mode: '501', players: [{ name: 'Anna' }, { name: 'Bo' }] });
    throwDart(m, { v: 20, m: 3 });
    throwDart(m, { v: 20, m: 3 });
    throwDart(m, { v: 1, m: 1 });
    endTurn(m);
    throwDart(m, { v: 19, m: 2 });
    const html = renderToStaticMarkup(
      createElement(TurnHistory, {
        match: matchState(m),
        onEditThrow: noop,
        onDeleteThrow: noop,
        onInsertThrow: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('Anna');
    expect(html).toContain('Bo');
    expect(html).toContain('T20');
    expect(html).toContain('D19');
    expect(html).toContain('121p'); // Annas tur: 60 + 60 + 1
  });

  it('TurnHistory - tom match kraschar inte', () => {
    const m = createMatch({ mode: 'FARFAR', players: [{ name: 'Anna' }] });
    const html = renderToStaticMarkup(
      createElement(TurnHistory, {
        match: matchState(m),
        onEditThrow: noop,
        onDeleteThrow: noop,
        onInsertThrow: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('Inga kast ännu');
  });
});
