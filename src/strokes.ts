// the raw strokes of a page can be a lot: a page full of writing is easily 50k points.
// above the cap the points are thinned out (ramer douglas peucker) until the page fits.

export const POINT_CAP = 60_000;

export interface RawStroke {
  points: number[][];
}

export function countPoints(strokes: RawStroke[]): number {
  return strokes.reduce((n, s) => n + (Array.isArray(s.points) ? s.points.length : 0), 0);
}

function distanceToSegment(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// keeps the first and last point and every point further than tolerance from the line between its kept neighbours
export function simplify(points: number[][], tolerance: number): number[][] {
  if (points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[i], points[first], points[last]);
      if (d > worstDistance) {
        worst = i;
        worstDistance = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function thin<T extends RawStroke>(strokes: T[], cap = POINT_CAP): { strokes: T[]; tolerance: number } {
  let tolerance = 0;
  let result = strokes;
  // double the tolerance until it fits, from a quarter of a page unit up
  while (countPoints(result) > cap && tolerance < 64) {
    tolerance = tolerance === 0 ? 0.25 : tolerance * 2;
    result = strokes.map((s) => ({ ...s, points: simplify(s.points, tolerance) }));
  }
  return { strokes: result, tolerance };
}
