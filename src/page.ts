// a braiNOTES page as the agent gets to see it: the picture, kept small enough for
// the client, and a short text with the layout found in the strokes.

import type { Bridge } from './server.js';
import type { NotesStatus, PageImage, PageRow } from './apps.js';
import { layout, type Box, type LayoutItem, type Stroke } from './layout.js';

// claude code cuts tool output at 25k tokens, images included; a page with its long
// side at 2000 px stays well under that
export const LONG_SIDE = 2000;

export interface PageText {
  id: string;
  x: number;
  y: number;
  w?: number;
  text: string;
  size?: number;
  color?: string;
}

export interface PageContent {
  w: number;
  h: number;
  strokes: (Stroke & { id: string })[];
  texts?: PageText[];
  shapes?: unknown[];
  images?: { id: string; x: number; y: number; w: number; h: number }[];
}

export interface PageView {
  png: string;
  text: string;
  scale: number;
  content: PageContent;
  items: LayoutItem[];
}

export function fitScale(w: number, h: number, scale: number, longSide = LONG_SIDE): number {
  const fit = Math.min(scale, longSide / Math.max(w, h, 1));
  return Math.floor(fit * 100) / 100;
}

export async function pageRow(bridge: Bridge, page: number): Promise<PageRow> {
  const rows = await bridge.call<PageRow[]>('brainotes', 'pages');
  const row = rows.find((r) => r.index === page);
  if (!row) {
    throw new Error(`There is no page ${page}. The notebook has ${rows.length} page${rows.length === 1 ? '' : 's'}, counted from 0.`);
  }
  return row;
}

export async function pageImage(bridge: Bridge, page: number, scale: number, region?: Box): Promise<PageImage> {
  return bridge.call<PageImage>('brainotes', 'page_image', region ? { page, scale, region } : { page, scale });
}

const r = (v: number) => Math.round(v * 10) / 10;

export function layoutText(items: LayoutItem[], content: PageContent): string {
  const lines: string[] = [];
  lines.push(`layout from ${content.strokes.length} strokes, top to bottom, boxes as x, y, w, h in page units:`);
  if (items.length === 0) lines.push('  no handwriting on this page');
  for (const item of items) {
    const { x, y, w, h } = item.box;
    const extra = item.kind === 'block' ? `${item.lines} lines, ` : '';
    lines.push(`  ${item.kind.padEnd(8)} ${x}, ${y}, ${w}, ${h}  ${extra}${item.strokes} stroke${item.strokes === 1 ? '' : 's'}`);
  }
  for (const t of content.texts ?? []) {
    lines.push(`  text     ${r(t.x)}, ${r(t.y)}  typed: ${JSON.stringify(t.text)}`);
  }
  for (const image of content.images ?? []) {
    lines.push(`  image    ${r(image.x)}, ${r(image.y)}, ${r(image.w)}, ${r(image.h)}  a picture, id ${image.id}`);
  }
  if (content.shapes?.length) lines.push(`  and ${content.shapes.length} shape${content.shapes.length === 1 ? '' : 's'} (lines, arrows, boxes)`);
  return lines.join('\n');
}

export async function readPage(bridge: Bridge, page: number, scale = 2): Promise<PageView> {
  const status = await bridge.call<NotesStatus>('brainotes', 'status');
  if (!status.notebook) throw new Error('No notebook is open in braiNOTES. Open one with notes_open first.');
  const row = await pageRow(bridge, page);
  const fit = fitScale(row.w, row.h, scale);
  const image = await pageImage(bridge, page, fit);
  const content = await bridge.call<PageContent>('brainotes', 'page_strokes', { page });
  const items = layout(content.strokes);
  const head =
    `page ${page} of "${status.notebook.name}", ${r(row.w)} x ${r(row.h)} page units` +
    `${row.pdf ? ' on a PDF page' : ''}, the image is ${image.w} x ${image.h} px at scale ${image.scale ?? fit}`;
  return { png: image.png, text: `${head}\n${layoutText(items, content)}`, scale: image.scale ?? fit, content, items };
}
