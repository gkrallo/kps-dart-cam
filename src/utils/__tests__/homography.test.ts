import { describe, it, expect } from 'vitest';
import {
  applyHomography,
  estimateHomography,
  homographyReprojectionError,
  invertMat3,
  jacobiEigenSymmetric,
  multiplyMat3,
  solveHomographyDLT,
  solveLinearSystem,
  type Mat3,
} from '../homography';
import { mulberry32, syntheticCamera } from '../syntheticBoard';
import type { Point } from '../../types';

/** Punkt på radie r mm, deg grader medurs från toppen. */
const polar = (r: number, deg: number): Point => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
};
const ring = (r: number, degs: number[]): Point[] => degs.map((d) => polar(r, d));

const CANON: Point[] = [
  { x: 0, y: -170 },
  { x: 170, y: 0 },
  { x: 0, y: 170 },
  { x: -170, y: 0 },
];

/** Gaussiskt brus från en seedad ström. */
function noiseStream(seed: number): () => number {
  const rng = mulberry32(seed);
  return () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

describe('3x3-matriser', () => {
  it('applyHomography med identitet lämnar punkten', () => {
    const I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(applyHomography(I, 3, 7)).toEqual({ x: 3, y: 7 });
  });

  it('invertMat3 gånger originalet är identiteten', () => {
    const H: Mat3 = [1.2, 0.1, 30, -0.05, 0.9, -12, 0.0002, -0.0001, 1];
    const round = multiplyMat3(H, invertMat3(H)!);
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let i = 0; i < 9; i++) expect(round[i]).toBeCloseTo(I[i], 9);
  });

  it('invertMat3 returnerar null för en singulär matris', () => {
    expect(invertMat3([1, 2, 3, 2, 4, 6, 1, 1, 1])).toBeNull();
  });
});

describe('solveLinearSystem', () => {
  it('löser ett 2x2-system', () => {
    const x = solveLinearSystem(
      [
        [2, 1],
        [1, 3],
      ],
      [3, 5],
    )!;
    expect(x[0]).toBeCloseTo(0.8, 9);
    expect(x[1]).toBeCloseTo(1.4, 9);
  });

  it('returnerar null för ett singulärt system', () => {
    expect(
      solveLinearSystem(
        [
          [1, 1],
          [1, 1],
        ],
        [2, 3],
      ),
    ).toBeNull();
  });
});

describe('jacobiEigenSymmetric', () => {
  it('hittar egenvärdena till en diagonalmatris', () => {
    const { values } = jacobiEigenSymmetric([
      [2, 0, 0],
      [0, 5, 0],
      [0, 0, 3],
    ]);
    expect([...values].sort((a, b) => a - b)).toEqual([2, 3, 5]);
  });

  it('hittar egenvektorn till minsta egenvärdet', () => {
    // [[2,1],[1,2]] har egenvärden 1 (vektor ~ (1,-1)) och 3 (vektor ~ (1,1)).
    const { values, vectors } = jacobiEigenSymmetric([
      [2, 1],
      [1, 2],
    ]);
    const minIdx = values[0] < values[1] ? 0 : 1;
    expect(values[minIdx]).toBeCloseTo(1, 9);
    const v = vectors[minIdx];
    expect(Math.abs(v[0] + v[1])).toBeCloseTo(0, 6);
  });
});

describe('solveHomographyDLT', () => {
  const cam = syntheticCamera({
    pitch: 0.3,
    yaw: -0.15,
    roll: 0.08,
    principalPoint: { x: 640, y: 360 },
  });
  const board = [...CANON, ...ring(170, [30, 60, 120, 210, 300]), ...ring(100, [0, 90, 180, 270]), { x: 0, y: 0 }];
  const image = board.map((p) => cam.project(p.x, p.y));

  it('återskapar homografin exakt utan brus', () => {
    const H = solveHomographyDLT(board, image)!;
    expect(homographyReprojectionError(H, board, image).rms).toBeLessThan(1e-6);
  });

  it('generaliserar till punkter den inte fick se', () => {
    const H = solveHomographyDLT(board, image)!;
    for (const p of ring(140, [15, 75, 200, 333])) {
      const got = applyHomography(H, p.x, p.y);
      const want = cam.project(p.x, p.y);
      expect(got.x).toBeCloseTo(want.x, 3);
      expect(got.y).toBeCloseTo(want.y, 3);
    }
  });

  it('returnerar null för för få eller degenererade punkter', () => {
    expect(solveHomographyDLT(board.slice(0, 3), image.slice(0, 3))).toBeNull();
    const same = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(solveHomographyDLT(same, same)).toBeNull();
  });
});

describe('överbestämd kalibrering slår fyra punkter under brus', () => {
  const truth = syntheticCamera({
    pitch: 0.35,
    yaw: 0.12,
    roll: -0.05,
    principalPoint: { x: 640, y: 360 },
  });

  const fourBoard = CANON;
  const manyBoard = [
    ...CANON,
    ...ring(170, [30, 60, 120, 150, 210, 240, 300, 330]),
    ...ring(103, [0, 90, 180, 270]),
  ];

  const testPts = [...ring(160, [10, 100, 190, 280]), ...ring(90, [40, 130, 220, 310]), ...ring(45, [0, 180]), { x: 0, y: 0 }];

  const rmsVsTruth = (H: Mat3): number => {
    let s = 0;
    for (const p of testPts) {
      const got = applyHomography(H, p.x, p.y);
      const want = truth.project(p.x, p.y);
      s += (got.x - want.x) ** 2 + (got.y - want.y) ** 2;
    }
    return Math.sqrt(s / testPts.length);
  };

  const trial = (seed: number, sigma: number) => {
    const g = noiseStream(seed);
    const noisy = (pts: Point[]) =>
      pts.map((p) => {
        const ip = truth.project(p.x, p.y);
        return { x: ip.x + g() * sigma, y: ip.y + g() * sigma };
      });
    const h4 = estimateHomography(fourBoard, noisy(fourBoard), { refine: true })!;
    const hMany = estimateHomography(manyBoard, noisy(manyBoard), { refine: true })!;
    return { e4: rmsVsTruth(h4.H), eMany: rmsVsTruth(hMany.H) };
  };

  it('ger lägre fel i snitt över många brusrealiseringar', () => {
    const N = 30;
    let sum4 = 0;
    let sumMany = 0;
    let wins = 0;
    for (let i = 0; i < N; i++) {
      const { e4, eMany } = trial(1000 + i * 7, 2.0);
      sum4 += e4;
      sumMany += eMany;
      if (eMany < e4) wins++;
    }
    expect(sumMany / N).toBeLessThan(sum4 / N);
    expect(wins).toBeGreaterThan(N * 0.6);
  });

  it('residualen speglar brusnivån', () => {
    const g = noiseStream(42);
    const sigma = 1.5;
    const noisy = manyBoard.map((p) => {
      const ip = truth.project(p.x, p.y);
      return { x: ip.x + g() * sigma, y: ip.y + g() * sigma };
    });
    const est = estimateHomography(manyBoard, noisy, { refine: true })!;
    expect(est.rms).toBeGreaterThan(0.3);
    expect(est.rms).toBeLessThan(4);
  });
});
