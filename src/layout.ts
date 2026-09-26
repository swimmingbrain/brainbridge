// lines, blocks and drawings on a handwritten page, found from the strokes alone.
// pure functions on boxes, so the tests can feed them made up pages.

export interface Stroke {
  id?: string;
  pen?: string;
  points: number[][];
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutItem {
  kind: 'line' | 'block' | 'drawing';
  box: Box;
  strokes: number;
  lines?: number;
}

interface Item {
  box: Box;
  points: number[][];
}

interface Group {
  kind: 'line' | 'block' | 'drawing';
  box: Box;
  items: Item[];
  lines: number;
}

export function boxOf(points: number[][]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// how far apart two boxes are vertically: negative when they overlap
function verticalGap(a: Box, b: Box): number {
  return Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
}

function touches(a: Box, b: Box, margin: number): boolean {
  return a.x - margin < b.x + b.w && b.x - margin < a.x + a.w && a.y - margin < b.y + b.h && b.y - margin < a.y + a.h;
}

function closed(item: Item): boolean {
  const first = item.points[0];
  const last = item.points[item.points.length - 1];
  const size = Math.max(item.box.w, item.box.h);
  return item.points.length >= 8 && Math.hypot(first[0] - last[0], first[1] - last[1]) < size * 0.2;
}

// the median height of the strokes that have one, the yardstick for every gap below
export function strokeUnit(items: { box: Box }[]): number {
  const heights = items.map((i) => i.box.h).filter((h) => h >= 0.5);
  return median(heights) || 10;
}

function findDrawings(items: Item[], unit: number): { drawings: Group[]; rest: Item[] } {
  const big = (i: Item) =>
    (i.box.w > 4 * unit && i.box.h > 4 * unit) || (closed(i) && i.box.w > 2.5 * unit && i.box.h > 2.5 * unit);
  const drawings: Group[] = items.filter(big).map((i) => ({ kind: 'drawing', box: i.box, items: [i], lines: 0 }));
  let rest = items.filter((i) => !big(i));
  // other long strokes that touch a drawing belong to it: axes, arrows, the curve on them.
  // small strokes stay text, so a label or a formula with a box around it is still read
  let grown = true;
  while (grown) {
    grown = false;
    for (const item of rest) {
      if (Math.max(item.box.w, item.box.h) <= 2 * unit) continue;
      const drawing = drawings.find((d) => touches(d.box, item.box, unit / 2));
      if (!drawing) continue;
      drawing.items.push(item);
      drawing.box = union(drawing.box, item.box);
      rest = rest.filter((r) => r !== item);
      grown = true;
      break;
    }
  }
  // drawings that ended up overlapping are one drawing
  const merged: Group[] = [];
  for (const d of drawings) {
    const other = merged.find((m) => touches(m.box, d.box, 0));
    if (other) {
      other.items.push(...d.items);
      other.box = union(other.box, d.box);
    } else {
      merged.push(d);
    }
  }
  return { drawings: merged, rest };
}

function findLines(items: Item[], unit: number): Group[] {
  const lines: Group[] = [];
  const sorted = [...items].sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2) || a.box.x - b.box.x);
  for (const item of sorted) {
    // the line this stroke overlaps most, or one that is less than half a stroke away.
    // a flat long stroke is an underline or a fraction bar, it reaches a bit further
    const flat = item.box.h < unit / 3 && item.box.w > 2 * unit;
    const reach = flat ? unit * 1.5 : unit / 2;
    let best: Group | null = null;
    let bestGap = Infinity;
    for (const line of lines) {
      const gap = verticalGap(line.box, item.box);
      if (gap < reach && gap < bestGap) {
        best = line;
        bestGap = gap;
      }
    }
    if (best) {
      best.items.push(item);
      best.box = union(best.box, item.box);
    } else {
      lines.push({ kind: 'line', box: item.box, items: [item], lines: 1 });
    }
  }
  // two lines that grew into each other are one line
  const merged: Group[] = [];
  for (const line of lines.sort((a, b) => a.box.y - b.box.y)) {
    const last = merged[merged.length - 1];
    const overlap = last ? -verticalGap(last.box, line.box) : 0;
    if (last && overlap > Math.min(last.box.h, line.box.h) / 2) {
      last.items.push(...line.items);
      last.box = union(last.box, line.box);
    } else {
      merged.push(line);
    }
  }
  return merged;
}

function findBlocks(lines: Group[]): Group[] {
  const lineHeight = median(lines.map((l) => l.box.h));
  const blocks: Group[] = [];
  for (const line of [...lines].sort((a, b) => a.box.y - b.box.y)) {
    const last = blocks[blocks.length - 1];
    const besides = last && line.box.x < last.box.x + last.box.w && last.box.x < line.box.x + line.box.w;
    if (last && besides && verticalGap(last.box, line.box) < lineHeight) {
      last.kind = 'block';
      last.items.push(...line.items);
      last.box = union(last.box, line.box);
      last.lines += 1;
    } else {
      blocks.push({ ...line, items: [...line.items] });
    }
  }
  return blocks;
}

function groups(strokes: Stroke[]): { unit: number; groups: Group[] } {
  // the highlighter marks text, it is not writing
  const items: Item[] = strokes
    .filter((s) => s.pen !== 'highlighter' && Array.isArray(s.points) && s.points.length > 0)
    .map((s) => ({ box: boxOf(s.points), points: s.points }));
  const unit = strokeUnit(items);
  const { drawings, rest } = findDrawings(items, unit);
  const all = [...findBlocks(findLines(rest, unit)), ...drawings];
  all.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return { unit, groups: all };
}

function round(box: Box): Box {
  const r = (v: number) => Math.round(v * 10) / 10;
  return { x: r(box.x), y: r(box.y), w: r(box.w), h: r(box.h) };
}

export function layout(strokes: Stroke[]): LayoutItem[] {
  return groups(strokes).groups.map((g) => {
    const item: LayoutItem = { kind: g.kind, box: round(g.box), strokes: g.items.length };
    if (g.kind === 'block') item.lines = g.lines;
    return item;
  });
}
