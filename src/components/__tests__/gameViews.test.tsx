import { describe, it, expect } from 'vitest';
import { createElement, type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameSetup } from '../GameSetup';
import { Scoreboard } from '../Scoreboard';
import { ThrowEditor } from '../ThrowEditor';
import { createMatch, matchState, throwDart } from '../../game/match';

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
});
