import { describe, it, expect } from 'vitest';
import { reconcileDarts, interpretCensus, DEFAULT_MATCH_PX } from '../dartCensus';
import type { Point } from '../../types';

/**
 * Avstämningen ersätter pixelräkningen `dBase < dTop`. Scenarierna nedan är de
 * verkliga: ett kast, en uttagning, en uttagning som blottar en dold pil, och
 * de fall där svaret ska bli "vet inte" i stället för en gissning.
 */

const p = (x: number, y: number): Point => ({ x, y });

// Tre pilar med gott om avstånd, i råbildskoordinater (1080x1920).
const A = p(500, 700);
const B = p(620, 900);
const C = p(430, 1050);

const census = (known: Point[], seen: Point[]) => reconcileDarts({ known, seen });
const verdict = (known: Point[], seen: Point[], sawAnything = true) =>
  interpretCensus(census(known, seen), { knownCount: known.length, sawAnything });

describe('reconcileDarts', () => {
  it('parar ihop pilar som inte rört sig', () => {
    const r = census([A, B], [B, A]);
    expect(r.matched).toHaveLength(2);
    expect(r.unregistered).toHaveLength(0);
    expect(r.removed).toHaveLength(0);
  });

  it('tål att samma pil mäts några pixlar isär mellan analyser', () => {
    const r = census([A, B], [p(A.x + 9, A.y - 6), p(B.x - 11, B.y + 4)]);
    expect(r.matched).toHaveLength(2);
    expect(r.unregistered).toHaveLength(0);
  });

  it('en blobb utan känd spets är en oregistrerad pil', () => {
    const r = census([A], [A, C]);
    expect(r.unregistered).toEqual([1]);
    expect(r.removed).toHaveLength(0);
  });

  it('en känd spets utan blobb är en uttagen pil', () => {
    const r = census([A, B, C], [A, C]);
    expect(r.removed).toEqual([1]);
    expect(r.unregistered).toHaveLength(0);
  });

  it('parar närmaste par först, inte i indexordning', () => {
    // Två kända och två sedda, korsvis. Girigheten ska välja de korta paren.
    const r = census([p(100, 100), p(140, 100)], [p(139, 102), p(101, 99)]);
    expect(r.matched).toHaveLength(2);
    const pairs = r.matched.map((m) => `${m.knownIndex}-${m.seenIndex}`).sort();
    expect(pairs).toEqual(['0-1', '1-0']);
  });

  it('en pil kan bara paras med en blobb', () => {
    const r = census([A], [p(A.x + 5, A.y), p(A.x - 5, A.y)]);
    expect(r.matched).toHaveLength(1);
    expect(r.unregistered).toHaveLength(1);
  });

  it('två pilar längre isär än matchningsavståndet hålls isär', () => {
    const far = p(A.x + DEFAULT_MATCH_PX + 5, A.y);
    const r = census([A], [far]);
    expect(r.matched).toHaveLength(0);
    expect(r.unregistered).toEqual([0]);
    expect(r.removed).toEqual([0]);
  });
});

describe('interpretCensus', () => {
  it('inget har hänt', () => {
    expect(verdict([A, B], [A, B])).toEqual({ kind: 'oförändrat' });
  });

  it('nytt kast', () => {
    expect(verdict([A], [A, B])).toEqual({ kind: 'nytt kast', seenIndex: 1 });
  });

  it('ren uttagning', () => {
    expect(verdict([A, B], [A])).toEqual({ kind: 'uttagning', knownIndexes: [1] });
  });

  it('hela tavlan tömd på en gång', () => {
    expect(verdict([A, B, C], [])).toEqual({ kind: 'uttagning', knownIndexes: [0, 1, 2] });
  });

  it('uttagning som blottar en dold pil', () => {
    // Två pilar smälte ihop till en kontur och registrerades som EN (vid A).
    // Den främre dras ut, och den som satt bakom blir synlig vid C.
    expect(verdict([A], [C])).toEqual({
      kind: 'uttagning med dold pil',
      knownIndexes: [0],
      seenIndex: 0,
    });
  });

  it('avstår hellre än registrerar två kast på en gång', () => {
    const v = verdict([A], [A, B, C]);
    expect(v.kind).toBe('osäker');
  });

  it('avstår när bildanalysen inte gick att köra', () => {
    // `seen` är tom för att analysen misslyckades, inte för att tavlan är tom.
    // Utan den här spärren hade det lästs som "alla pilar borttagna".
    const v = interpretCensus(census([A, B], []), { knownCount: 2, sawAnything: false });
    expect(v.kind).toBe('osäker');
  });

  it('men en tom tavla med lyckad analys ÄR en uttagning', () => {
    expect(verdict([A, B], [], true)).toEqual({ kind: 'uttagning', knownIndexes: [0, 1] });
  });

  it('tom tavla utan kända pilar är oförändrat, inte osäkert', () => {
    expect(interpretCensus(census([], []), { knownCount: 0, sawAnything: false })).toEqual({
      kind: 'oförändrat',
    });
  });
});

describe('det gamla pixelfallet som var ett myntkast', () => {
  it('två lika stora pilar: avstämningen vet vilken som är kvar', () => {
    // `dBase < dTop` kunde inte skilja de här åt - lika stora blobbar ger
    // nästan lika stora diffar. Positionen är entydig.
    const known = [A, B];
    expect(verdict(known, [A])).toEqual({ kind: 'uttagning', knownIndexes: [1] });
    expect(verdict(known, [B])).toEqual({ kind: 'uttagning', knownIndexes: [0] });
  });

  it('pilarna dras ut i FEL ordning och det spelar ingen roll', () => {
    // Först den som kastades först (index 0). Stackmetoden antog sist-först.
    expect(verdict([A, B, C], [B, C])).toEqual({ kind: 'uttagning', knownIndexes: [0] });
  });
});

describe('riktningskontrollen (materialDelta)', () => {
  const judge = (known: Point[], seen: Point[], materialDelta: 'more' | 'less' | 'unknown') =>
    interpretCensus(census(known, seen), {
      knownCount: known.length,
      sawAnything: true,
      materialDelta,
    });

  it('en känd pil tappas ur masken samtidigt som ett kast: MER material = nytt kast', () => {
    // Utan riktningskontrollen ser det här ut exakt som en uttagning som
    // blottar en dold pil, och pil A hade raderats ur ställningen.
    expect(judge([A], [B], 'more')).toEqual({ kind: 'nytt kast', seenIndex: 0 });
  });

  it('samma mönster med MINDRE material är en dold pil', () => {
    expect(judge([A], [B], 'less')).toEqual({
      kind: 'uttagning med dold pil',
      knownIndexes: [0],
      seenIndex: 0,
    });
  });

  it('utan riktningsuppgift antas dold pil, som förut', () => {
    expect(judge([A], [B], 'unknown').kind).toBe('uttagning med dold pil');
  });

  it('en pil syns inte i masken men materialet ökade: avstå, ta inte bort den', () => {
    expect(judge([A, B], [A], 'more').kind).toBe('osäker');
  });

  it('en ny blobb men mindre material: avstå, registrera inget kast', () => {
    expect(judge([A], [A, B], 'less').kind).toBe('osäker');
  });

  it('riktningen ändrar inte de entydiga fallen', () => {
    expect(judge([A], [A, B], 'more')).toEqual({ kind: 'nytt kast', seenIndex: 1 });
    expect(judge([A, B], [A], 'less')).toEqual({ kind: 'uttagning', knownIndexes: [1] });
    expect(judge([A, B], [A, B], 'more')).toEqual({ kind: 'oförändrat' });
  });
});
