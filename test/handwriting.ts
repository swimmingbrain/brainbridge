// a made up handwritten A4 page for the tests and the fake app: a heading, a paragraph,
// a derivation of three lines with fractions, another paragraph and a sketch of a graph.
// the same seed always gives the same strokes.

export interface FakeStroke {
  id: string;
  pen: string;
  color: string;
  size: number;
  box: { x: number; y: number; w: number; h: number };
  points: number[][];
}

function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fakePage(seed = 7): { w: number; h: number; strokes: FakeStroke[] } {
  const rand = random(seed);
  const strokes: FakeStroke[] = [];
  const jitter = (v: number, amount = 0.4) => v + (rand() - 0.5) * amount;

  const add = (points: number[][], pen = 'ballpoint'): void => {
    const rounded = points.map(([x, y], i) => [
      Math.round(jitter(x) * 10) / 10,
      Math.round(jitter(y) * 10) / 10,
      Math.round((0.4 + 0.4 * Math.sin((i / points.length) * Math.PI)) * 100) / 100
    ]);
    const xs = rounded.map((p) => p[0]);
    const ys = rounded.map((p) => p[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    strokes.push({ id: `s${strokes.length + 1}`, pen, color: '#1c1c1c', size: 1.6, box, points: rounded });
  };

  const arc = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, n: number): number[][] => {
    const points: number[][] = [];
    for (let i = 0; i <= n; i++) {
      const a = from + ((to - from) * i) / n;
      points.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return points;
  };

  const segment = (x0: number, y0: number, x1: number, y1: number, n: number): number[][] => {
    const points: number[][] = [];
    for (let i = 0; i <= n; i++) points.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
    return points;
  };

  // one letter with its baseline at y, k scales it; returns its width
  const letter = (x: number, y: number, k = 1): number => {
    const xh = 7 * k;
    const kind = Math.floor(rand() * 6);
    if (kind === 0) {
      add(arc(x + xh / 2, y - xh / 2, xh / 2, xh / 2, 0, Math.PI * 2, 12));
    } else if (kind === 1) {
      add([...segment(x, y, x, y - xh, 3), ...arc(x + xh / 2, y - xh + 2 * k, xh / 2, 2 * k, Math.PI, Math.PI * 2, 5), ...segment(x + xh, y - xh + 2 * k, x + xh, y, 3)]);
    } else if (kind === 2) {
      add([...segment(x + 1, y - 11 * k, x + 1, y, 6), ...segment(x + 1, y, x + 3 * k, y - 1, 2)]);
      return 4 * k;
    } else if (kind === 3) {
      add([...arc(x + xh / 2, y - xh / 2, xh / 2, xh / 2, -Math.PI / 4, Math.PI * 1.8, 8), ...segment(x + xh, y - xh / 2, x + xh, y + 4 * k, 3), ...arc(x + xh / 2, y + 4 * k, xh / 2, 1.5 * k, 0, Math.PI, 3)]);
    } else if (kind === 4) {
      add(segment(x + 2 * k, y - 11 * k, x + 2 * k, y, 6));
      add(segment(x, y - xh, x + 5 * k, y - xh, 3));
      return 6 * k;
    } else {
      add(segment(x + 1, y - xh, x + 1, y, 4));
      add([[x + 1, y - xh - 3 * k], [x + 1.3, y - xh - 3.2 * k]]);
      return 3 * k;
    }
    return xh + 1;
  };

  const words = (x0: number, x1: number, y: number, k = 1): void => {
    let x = x0;
    while (x < x1) {
      const count = 2 + Math.floor(rand() * 6);
      for (let i = 0; i < count && x < x1; i++) x += letter(x, y, k) + 1;
      x += 7 * k;
    }
  };

  // heading, underlined
  words(50, 210, 70, 1.6);
  add(segment(48, 78, 215, 78.5, 12));

  // a paragraph on ruled spacing
  for (const y of [110, 134, 158]) words(50, 540, y);

  // a derivation: f(x) = a over b, three times, the equals signs below each other
  for (const y of [210, 250, 290]) {
    let x = 70;
    x += letter(x, y) + 2;
    add(arc(x + 4, y - 4, 3, 9, Math.PI * 0.6, Math.PI * 1.4, 6));
    x += 5;
    x += letter(x, y) + 1;
    add(arc(x, y - 4, 3, 9, -Math.PI * 0.4, Math.PI * 0.4, 6));
    x = 150;
    add(segment(x, y - 5, x + 9, y - 5, 4));
    add(segment(x, y - 1, x + 9, y - 1, 4));
    x = 175;
    let nx = x + 4;
    for (let i = 0; i < 3; i++) nx += letter(nx, y - 9) + 1;
    add(segment(x, y - 4, x + 36, y - 4.5, 10));
    let dx = x + 8;
    for (let i = 0; i < 2; i++) dx += letter(dx, y + 9) + 1;
    x = 230;
    add(arc(x + 4, y - 3, 4, 3, Math.PI, Math.PI * 2.4, 6));
    words(250, 330, y);
  }

  // another paragraph
  for (const y of [345, 369]) words(50, 540, y);

  // a graph: the axes in one go, a curve and a circle on it, labels at the ends
  add([...segment(330, 430, 330, 580, 20), ...segment(330, 580, 520, 580, 20)]);
  add(arc(425, 590, 90, 140, Math.PI * 1.05, Math.PI * 1.45, 20));
  add(arc(450, 500, 18, 18, 0, Math.PI * 2, 16));
  letter(318, 428);
  letter(526, 590);

  // a last line under the graph
  words(50, 400, 640);

  return { w: 595, h: 842, strokes };
}
