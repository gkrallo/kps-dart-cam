import { describe, it, expect } from 'vitest';
import { createElement, type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameSetup } from '../GameSetup';
import { Scoreboard } from '../Scoreboard';
import { ThrowEditor } from '../ThrowEditor';
import { TurnHistory } from '../TurnHistory';
import { HelpPanel } from '../HelpPanel';
import { ResumeCard } from '../ResumeCard';
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

describe('ResumeCard', () => {
  const built = (mode: 'FARFAR' | '501') => {
    const m = createMatch({ mode, players: [{ name: 'Kristian' }, { name: 'Anders' }] });
    throwDart(m, { v: 20, m: 3 });
    return matchState(m);
  };

  it('visar ställningen och vem som står på tur', () => {
    const html = renderToStaticMarkup(
      createElement(ResumeCard, {
        state: built('501'),
        lastPlayedAt: Date.now() - 12 * 60 * 1000,
        onResume: noop,
        onNewGame: noop,
      }),
    );
    expect(html).toContain('Fortsätt matchen?');
    expect(html).toContain('Kristian');
    expect(html).toContain('Anders');
    expect(html).toContain('står på tur');
    expect(html).toContain('för 12 minuter sedan');
  });

  it('Farfar visar sparade pilar i stället för poäng kvar', () => {
    const html = renderToStaticMarkup(
      createElement(ResumeCard, {
        state: built('FARFAR'),
        lastPlayedAt: Date.now() - 5000,
        onResume: noop,
        onNewGame: noop,
      }),
    );
    expect(html).toContain('sparade');
    expect(html).toContain('Runda');
  });

  it('en avgjord match erbjuder inte "Fortsätt"', () => {
    const m = createMatch({ mode: '501', players: [{ name: 'Kristian' }] });
    // Att spela ner 501 till noll här skulle bara göra testet långt; kortet
    // bryr sig bara om flaggan.
    const st = { ...matchState(m), finished: true, winners: ['Kristian'] };
    const html = renderToStaticMarkup(
      createElement(ResumeCard, {
        state: st,
        lastPlayedAt: Date.now(),
        onResume: noop,
        onNewGame: noop,
        onPlayAgain: noop,
      }),
    );
    expect(html).toContain('Matchen är slut');
    expect(html).toContain('Spela igen');
    expect(html).not.toContain('>Fortsätt<');
  });
});

describe('Scoreboard: statusrad och nödutgång', () => {
  const scoreboardProps = (extra: Record<string, unknown>) => {
    const m = createMatch({ mode: '501', players: [{ name: 'Kristian' }, { name: 'Anders' }] });
    throwDart(m, { v: 20, m: 1 });
    return {
      match: matchState(m),
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
      ...extra,
    };
  };

  it('visar vad appen väntar på', () => {
    const html = renderToStaticMarkup(
      createElement(Scoreboard, scoreboardProps({
        prompt: { text: 'Kasta, Kristian', waiting: false },
      }) as never),
    );
    expect(html).toContain('Kasta, Kristian');
  });

  it('"Avsluta tur" syns inte i normalfallet', () => {
    const html = renderToStaticMarkup(
      createElement(Scoreboard, scoreboardProps({}) as never),
    );
    expect(html).not.toContain('Avsluta tur');
  });

  it('...men erbjuds när något hängt sig', () => {
    const html = renderToStaticMarkup(
      createElement(Scoreboard, scoreboardProps({ showManualNext: true }) as never),
    );
    expect(html).toContain('Avsluta tur');
  });
});
