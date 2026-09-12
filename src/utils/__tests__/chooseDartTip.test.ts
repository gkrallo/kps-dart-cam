import { describe, it, expect } from 'vitest';
import {
  chooseDartTip,
  MAX_CENTROID_ELONGATION,
  MIN_AXIS_CONFIDENCE,
  type DartAxisResult,
  type TipChoiceInput,
} from '../dartTip';
import type { Point } from '../../types';

/*
 * Reglerna för vilken spetsmetod som ska tros på är framtrimmade mot riktiga
 * kast på Kristians tavla 2026-09-12, och låg tidigare begravda i
 * `useDartDetector` - alltså i OpenCV-beroende kod som inte går att testa.
 * Här låses de med de FAKTISKA siffrorna ur den sessionens logg, så att en
 * framtida justering inte tyst kan släppa igenom det vi mätte bort.
 */

/** En avlång blob av `n` punkter, för tyngdpunktsräkningen. */
const blob = (n = 40): Point[] =>
  Array.from({ length: n }, (_, i) => ({ x: 100 + i, y: 200 + i * 0.2 }));

const axisWith = (confidence: number, elongation: number): DartAxisResult => ({
  tip: { x: 111, y: 222 },
  tail: { x: 333, y: 444 },
  axis: { x: 1, y: 0 },
  centroid: { x: 200, y: 300 },
  elongation,
  tipWidthPx: 25,
  tailWidthPx: 110,
  confidence,
});

const input = (over: Partial<TipChoiceInput> = {}): TipChoiceInput => ({
  points: blob(),
  elongation: 3,
  axis: null,
  isLightingOnly: false,
  lightingDecided: true,
  ...over,
});

describe('chooseDartTip - riktiga kast 2026-09-12 ska accepteras', () => {
  // Loggade som "PIL registrerad" och verifierade mot rätt fält av Kristian.
  it.each([
    ['T8 / S8', 0.79, 2.5, 2.3],
    ['DB, vinge mot 20', 0.77, 3.4, 2.9],
    ['25 vid bullen', 0.8, 2.7, 2.1],
    ['DB, vinge mot 6 - lägsta äkta konfidensen vi sett', 0.43, 5.2, 3.7],
  ])('%s (conf %f) väljer axelmetoden', (_namn, conf, axisElong, rectElong) => {
    const res = chooseDartTip(input({ axis: axisWith(conf, axisElong), elongation: rectElong }));
    expect(res.tip).toEqual({ x: 111, y: 222 });
    expect(res.how).toContain('axel');
  });

  // Frontala pilar: axeln gick inte att anpassa, blobben är en kompakt klump.
  it.each([
    ['frontal pil, elong 1.0', 1.0],
    ['frontal pil, elong 1.1', 1.1],
    ['frontal pil, elong 1.3', 1.3],
  ])('%s väljer tyngdpunkten', (_namn, rectElong) => {
    const res = chooseDartTip(input({ axis: null, elongation: rectElong, lightingDecided: true }));
    expect(res.tip).not.toBeNull();
    expect(res.how).toContain('tyngdpunkt');
  });
});

describe('chooseDartTip - dagens artefakter ska förkastas', () => {
  /*
   * Dessa fyra är armen i bildkanten vid handplacering. Med det GAMLA taket
   * för tyngdpunkten (elong 5) släpptes de igenom som "frontal pil" och
   * räddades bara av att spetsen hamnade utanför tavlan. Nu stoppas de redan
   * på formen.
   */
  it.each([
    ['arm, conf 0.09', 0.09, 3.7, 3.8],
    ['arm, conf 0.10', 0.1, 3.2, 3.3],
    ['arm, conf 0.15', 0.15, 4.3, 4.3],
    ['artefakt, conf 0.23', 0.23, 3.5, 3.6],
  ])('%s avstår', (_namn, conf, axisElong, rectElong) => {
    const res = chooseDartTip(input({ axis: axisWith(conf, axisElong), elongation: rectElong }));
    expect(res.tip).toBeNull();
    expect(res.how).toContain('avstår');
  });

  it('ett ljusskifte är ingen pil, hur avlångt det än är', () => {
    // Uppmätt: r=0.91, lutning 1.54 ("54 % ljusare"), elong 2.7 - hade annars
    // blivit ett spökkast via tyngdpunkten.
    const res = chooseDartTip(
      input({ elongation: 2.7, isLightingOnly: true, lightingReason: 'reflex: 54 % ljusare' }),
    );
    expect(res.tip).toBeNull();
    expect(res.how).toContain('54 %');
  });

  it('en linje (spindeltråd, tavelkant, kabel) förkastas på axelns avlånghet', () => {
    const res = chooseDartTip(input({ axis: axisWith(0.9, 24), elongation: 11 }));
    expect(res.tip).toBeNull();
    expect(res.how).toContain('för avlång');
  });

  it('en rund fläck som skuggtestet inte kunde mäta på avstår', () => {
    const res = chooseDartTip(input({ axis: null, elongation: 1.2, lightingDecided: false }));
    expect(res.tip).toBeNull();
    expect(res.how).toContain('skuggtestet');
  });
});

describe('chooseDartTip - gränserna', () => {
  it('tyngdpunkten används inte för långa blobbar, där den garanterat är fel', () => {
    // Precis över taket: tyngdpunkten i en lång blob sitter mitt på pilkroppen.
    const straxOver = chooseDartTip(
      input({ axis: null, elongation: MAX_CENTROID_ELONGATION + 0.1 }),
    );
    expect(straxOver.tip).toBeNull();
    const precisUnder = chooseDartTip(
      input({ axis: null, elongation: MAX_CENTROID_ELONGATION - 0.1 }),
    );
    expect(precisUnder.tip).not.toBeNull();
  });

  it('axeln vinner över tyngdpunkten så snart konfidensen räcker', () => {
    // Samma blob, konfidens strax under respektive över gränsen.
    const under = chooseDartTip(
      input({ axis: axisWith(MIN_AXIS_CONFIDENCE - 0.01, 4), elongation: 4 }),
    );
    expect(under.tip).toBeNull(); // elong 4 > taket för tyngdpunkt -> avstå

    const over = chooseDartTip(
      input({ axis: axisWith(MIN_AXIS_CONFIDENCE + 0.01, 4), elongation: 4 }),
    );
    expect(over.how).toContain('axel');
  });

  it('tål en tom kontur', () => {
    expect(chooseDartTip(input({ points: [], elongation: 1.2 })).tip).toBeNull();
  });
});
