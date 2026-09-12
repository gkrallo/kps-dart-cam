import { describe, it, expect } from 'vitest';
import { classifyShadow, type BlobSample } from '../shadowTest';
import { mulberry32, renderSyntheticBoard, syntheticCamera } from '../syntheticBoard';

/*
 * Testerna kör mot en riktigt renderad tavla, inte påhittade siffror: det är
 * tavlans egen struktur (vita fält, röda band, spindeltråd) som skuggtestet
 * korrelerar mot, så underlaget måste ha samma sorts mönster som i verkligheten.
 */

// principalPoint mitt i bilden, annars hamnar bullseye i pixel (0,0) och nästan
// hela bilden blir bakgrund. Tavlans radie blir ~95 px här (170 mm · 1400 / 2500).
const cam = syntheticCamera({ principalPoint: { x: 200, y: 200 } });
const img = renderSyntheticBoard({ width: 400, height: 400, unproject: cam.unproject });

/** Gråvärden längs en diagonal genom tavlan (passerar flera fält och ringar). */
function boardGrays(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const px = Math.round(125 + t * 150);
    const py = Math.round(125 + t * 150);
    const idx = (py * img.width + px) * 4;
    out.push(0.299 * img.data[idx] + 0.587 * img.data[idx + 1] + 0.114 * img.data[idx + 2]);
  }
  return out;
}

/** Bara pixlar som skiljer sig tillräckligt mycket - samma filter som detektorn. */
const thresholded = (samples: BlobSample[]): BlobSample[] =>
  samples.filter((s) => Math.abs(s.cur - s.base) > 15);

describe('classifyShadow', () => {
  const rng = mulberry32(11);
  const noise = () => (rng() - 0.5) * 6; // ±3 gråvärden, som kamerabrus

  it('känner igen en skugga över tavlan', () => {
    const base = boardGrays(300);
    const samples = thresholded(base.map((b) => ({ base: b, cur: b * 0.55 + noise() })));
    const v = classifyShadow(samples);
    expect(v.isLightingOnly).toBe(true);
    expect(v.slope).toBeGreaterThan(0.4);
    expect(v.slope).toBeLessThan(0.7);
    expect(v.correlation).toBeGreaterThan(0.9);
  });

  it('känner igen en svag skugga (bara 20 % mörkare)', () => {
    const base = boardGrays(300);
    const samples = thresholded(base.map((b) => ({ base: b, cur: b * 0.8 + noise() })));
    expect(classifyShadow(samples).isLightingOnly).toBe(true);
  });

  it('känner igen en reflex som gör ytan ljusare', () => {
    const base = boardGrays(300);
    const samples = thresholded(base.map((b) => ({ base: b, cur: Math.min(255, b * 1.35 + noise()) })));
    const v = classifyShadow(samples);
    expect(v.isLightingOnly).toBe(true);
    expect(v.slope).toBeGreaterThan(1);
  });

  it('en pil är INTE en ljusändring - pilens material ersätter underlaget', () => {
    const base = boardGrays(300);
    // Mörk pilkropp: samma gråvärde oavsett vilket fält den ligger över.
    const samples = thresholded(base.map((b) => ({ base: b, cur: 38 + noise() })));
    const v = classifyShadow(samples);
    expect(v.isLightingOnly).toBe(false);
    expect(v.correlation).toBeLessThan(0.5);
  });

  it('en pil med blank skaftdel är inte heller en ljusändring', () => {
    const base = boardGrays(300);
    const samples = thresholded(
      base.map((b, i) => ({ base: b, cur: (i % 3 === 0 ? 185 : 45) + noise() })),
    );
    expect(classifyShadow(samples).isLightingOnly).toBe(false);
  });

  it('markerar `decided` när testet kunde mäta - avgörande för frontala pilar', () => {
    // Detektorn släpper igenom en rund (frontal) pil bara om skuggtestet
    // AKTIVT frikänt den. Skillnaden mellan "mätt: inget ljusskifte" och
    // "kunde inte mäta" måste därför gå att läsa av.
    const base = boardGrays(300);
    const dart = thresholded(base.map((b) => ({ base: b, cur: 38 + noise() })));
    expect(classifyShadow(dart)).toMatchObject({ isLightingOnly: false, decided: true });

    const flat: BlobSample[] = Array.from({ length: 200 }, () => ({ base: 28, cur: 120 }));
    expect(classifyShadow(flat)).toMatchObject({ isLightingOnly: false, decided: false });

    const tooFew = base.slice(0, 10).map((b) => ({ base: b, cur: 38 }));
    expect(classifyShadow(tooFew).decided).toBe(false);
  });

  it('svarar "vet inte" när underlaget är enfärgat', () => {
    // Pil mitt i ett svart fält: referensen har inget mönster att känna igen.
    const samples: BlobSample[] = Array.from({ length: 200 }, () => ({
      base: 28 + noise(),
      cur: 120 + noise(),
    }));
    const v = classifyShadow(samples);
    expect(v.isLightingOnly).toBe(false);
    expect(v.reason).toContain('struktur');
  });

  it('svarar "vet inte" vid för få punkter', () => {
    const base = boardGrays(20);
    const samples = base.map((b) => ({ base: b, cur: b * 0.5 }));
    const v = classifyShadow(samples);
    expect(v.isLightingOnly).toBe(false);
    expect(v.reason).toContain('för få');
  });

  it('en yta som blir nästan svart räknas som föremål, inte skugga', () => {
    // Utan brus följer mönstret referensen perfekt (r = 1) - ändå ska det inte
    // räknas som skugga: en skugga som släcker ut 95 % av ljuset är ett
    // föremål. Det är lutningsgolvet som fångar det, inte korrelationen.
    const base = boardGrays(300);
    const samples = thresholded(base.map((b) => ({ base: b, cur: b * 0.05 })));
    const v = classifyShadow(samples);
    expect(v.isLightingOnly).toBe(false);
    expect(v.reason).toContain('föremål');
  });

  it('oförändrad yta räknas inte som ljusändring', () => {
    const base = boardGrays(300);
    const samples = base.map((b) => ({ base: b, cur: b + noise() }));
    expect(classifyShadow(samples).isLightingOnly).toBe(false);
  });
});
