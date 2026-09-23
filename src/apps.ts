// what the two tabs answer to the commands this server sends, as far as the server looks at it

export interface NotesStatus {
  notebook: { id: string; name: string; kind: 'paper' | 'board'; pages: number } | null;
  page: number;
  tool?: string;
  zoom?: number;
  version?: string;
}

export interface NotebookRow {
  id: string;
  name: string;
  kind: 'paper' | 'board';
  pages: number;
  updatedAt?: number | string;
  tex: string | null;
}

export interface PageRow {
  index: number;
  id: string;
  w: number;
  h: number;
  items?: number;
  pdf?: boolean;
}

export interface PageImage {
  png: string;
  w: number;
  h: number;
  scale: number;
}

export interface TexStatus {
  project: { name: string; kind: 'browser' | 'folder'; notes: string | null } | null;
  file: string | null;
  cursor?: { line: number; col: number };
  compiling?: boolean;
  last?: { ok: boolean; errors: number; warnings: number } | null;
  version?: string;
}

export interface CompileStatus {
  state: 'idle' | 'compiling' | 'ready' | 'error';
  problems: string;
  log: string | string[];
}

export function findNotebook(rows: NotebookRow[], key: string): NotebookRow | undefined {
  return rows.find((r) => r.id === key) ?? rows.find((r) => r.name.toLowerCase() === key.trim().toLowerCase());
}
