import { describe, expect, it } from 'vitest';
import { boxOf, layout, mathBoxes, strokeUnit } from '../src/layout.js';
import { fakePage } from './handwriting.js';

// a stroke made of a few points along a straight line
function line(x0: number, y0: number, x1: number, y1: number) {
  return { points: [0, 0.25, 0.5, 0.75, 1].map((t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.5]) };
}

// a row of small letters with their baseline at y
function word(x: number, y: number, letters: number) {
  return Array.from({ length: letters }, (_, i) => line(x + i * 7, y - 7, x + i * 7 + 5, y));
}

describe('layout', () => {
  it('measures boxes and the stroke unit', () => {
    expect(boxOf([[1, 2], [5, 9], [3, 4]])).toEqual({ x: 1, y: 2, w: 4, h: 7 });
    expect(strokeUnit([{ box: { x: 0, y: 0, w: 1, h: 7 } }, { box: { x: 0, y: 0, w: 1, h: 0 } }, { box: { x: 0, y: 0, w: 1, h: 9 } }])).toBe(9);
    expect(layout([])).toEqual([]);
  });

  it('puts letters at the same height on one line and far apart lines apart', () => {
    const items = layout([...word(50, 100, 10), ...word(50, 160, 8)]);
    expect(items.map((i) => i.kind)).toEqual(['line', 'line']);
    expect(items[0]).toMatchObject({ strokes: 10, box: { x: 50, y: 93, w: 68, h: 7 } });
  });

  it('joins close lines into a block and keeps a blank line between blocks', () => {
    const items = layout([...word(50, 100, 10), ...word(50, 112, 9), ...word(50, 124, 9), ...word(50, 170, 6)]);
    expect(items.map((i) => i.kind)).toEqual(['block', 'line']);
    expect(items[0]).toMatchObject({ lines: 3, strokes: 28 });
  });

  it('keeps an underline with its heading', () => {
    const items = layout([...word(50, 100, 10), line(48, 104, 120, 104.5)]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'line', strokes: 11 });
  });

  it('leaves the highlighter out', () => {
    const items = layout([...word(50, 100, 4), { pen: 'highlighter', points: [[40, 90], [200, 300]] }]);
    expect(items).toEqual([{ kind: 'line', box: { x: 50, y: 93, w: 26, h: 7 }, strokes: 4 }]);
  });

  it('finds the heading, the paragraphs, the derivation and the graph of a whole page', () => {
    const { strokes } = fakePage();
    expect(strokes.length).toBeGreaterThan(300);
    const items = layout(strokes);
    expect(items.map((i) => (i.kind === 'block' ? `block of ${i.lines}` : i.kind))).toEqual([
      'line',
      'block of 3',
      'block of 3',
      'block of 2',
      'line',
      'drawing',
      'line',
      'line'
    ]);
    const drawing = items.find((i) => i.kind === 'drawing')!;
    expect(drawing.strokes).toBe(3);
    expect(drawing.box.x).toBeCloseTo(330, 0);
    expect(drawing.box.w).toBeCloseTo(190, 0);
    expect(items.reduce((n, i) => n + i.strokes, 0)).toBe(strokes.length);
  });

  it('marks the derivation as math and the paragraphs not', () => {
    const boxes = mathBoxes(fakePage().strokes);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].y).toBeGreaterThan(180);
    expect(boxes[0].y + boxes[0].h).toBeLessThan(320);
    expect(mathBoxes([...word(50, 100, 3), line(50, 104, 75, 104)])).toEqual([]);
    expect(mathBoxes([...word(50, 95, 3), line(48, 99, 75, 99.5), ...word(50, 112, 3)])).toHaveLength(1);
  });
});
