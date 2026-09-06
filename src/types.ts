export interface Point {
  x: number;
  y: number;
}

export interface DartScore {
  baseScore: number;     // 0-25
  multiplier: number;    // 0 (Miss), 1 (Single), 2 (Double), 3 (Triple)
  totalPoints: number;   // baseScore * multiplier
  label: string;         // e.g. "T20", "D16", "S5", "DB", "25", "MISS"
  coordinates?: Point;
}

export interface TurnRecord {
  darts: DartScore[];
  scoreBeforeTurn: number;
  scoreAfterTurn: number;
  isBust: boolean;
}

