import { describe, expect, it } from 'vitest';
import { countPoints, simplify, thin } from '../src/strokes.js';
import { fakePage } from './handwriting.js';

describe('strokes', () => {
  it('drops points on a straight line and keeps the corners', () => {
    const points = [[0, 0, 0.5], [1, 0, 0.5], [2, 0, 0.5], [3, 0, 0.5], [3, 1, 0.5], [3, 2, 0.5]];
    expect(simplify(points, 0.1)).toEqual([[0, 0, 0.5], [3, 0, 0.5], [3, 2, 0.5]]);
    expect(simplify([[0, 0], [1, 1]], 1)).toEqual([[0, 0], [1, 1]]);
  });

  it('leaves a page under the cap as it is', () => {
    const { strokes } = fakePage();
    const result = thin(strokes);
    expect(result.tolerance).toBe(0);
    expect(result.strokes).toBe(strokes);
  });

  it('thins a page over the cap until it fits', () => {
    const { strokes } = fakePage();
    const before = countPoints(strokes);
    const result = thin(strokes, 2000);
    expect(result.tolerance).toBeGreaterThan(0);
    expect(countPoints(result.strokes)).toBeLessThanOrEqual(2000);
    expect(countPoints(result.strokes)).toBeLessThan(before);
    expect(result.strokes).toHaveLength(strokes.length);
    expect(result.strokes[0].id).toBe(strokes[0].id);
  });
});
