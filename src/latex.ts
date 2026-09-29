// every math span of a text parsed with katex, so a formula that came out garbled
// is caught before it lands in a project. katex knows less than a full latex, but
// what it cannot parse is almost always broken for latex too.

import katex from 'katex';

const ENVIRONMENTS = ['align', 'align*', 'equation', 'equation*', 'gather', 'gather*'];

export interface MathSpan {
  // what opened it: $, $$, \(, \[ or the environment name
  open: string;
  tex: string;
  start: number;
  closed: boolean;
}

export interface MathProblem {
  line: number;
  math: string;
  error: string;
}

// code in markdown is not math; blank it out but keep the positions
function withoutCode(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  return text.replace(/```[\s\S]*?```/g, blank).replace(/`[^`\n]*`/g, blank);
}

// the index of the next $ that is not escaped, from i on
function nextDollar(text: string, i: number): number {
  while (i < text.length) {
    if (text[i] === '\\') i += 2;
    else if (text[i] === '$') return i;
    else i += 1;
  }
  return -1;
}

export function mathSpans(input: string): MathSpan[] {
  const text = withoutCode(input);
  const spans: MathSpan[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\') {
      const next = text[i + 1];
      if (next === '(' || next === '[') {
        const close = next === '(' ? '\\)' : '\\]';
        const end = text.indexOf(close, i + 2);
        spans.push({ open: `\\${next}`, tex: input.slice(i + 2, end < 0 ? text.length : end), start: i, closed: end >= 0 });
        i = end < 0 ? text.length : end + 2;
        continue;
      }
      const begin = /^\\begin\{([a-zA-Z]+\*?)\}/.exec(text.slice(i, i + 30));
      if (begin && ENVIRONMENTS.includes(begin[1])) {
        const close = `\\end{${begin[1]}}`;
        const from = i + begin[0].length;
        const end = text.indexOf(close, from);
        spans.push({ open: begin[1], tex: input.slice(from, end < 0 ? text.length : end), start: i, closed: end >= 0 });
        i = end < 0 ? text.length : end + close.length;
        continue;
      }
      // an escaped character like \$ or a command, step over both
      i += 2;
      continue;
    }
    if (text[i] === '$') {
      const display = text[i + 1] === '$';
      const from = i + (display ? 2 : 1);
      const end = nextDollar(text, from);
      const closed = end >= 0 && (!display || text[end + 1] === '$');
      spans.push({ open: display ? '$$' : '$', tex: input.slice(from, end < 0 ? text.length : end), start: i, closed });
      if (end < 0) break;
      i = end + (display && closed ? 2 : 1);
      continue;
    }
    i += 1;
  }
  return spans;
}

// what katex parses for each kind of span
function source(span: MathSpan): { tex: string; display: boolean } {
  const body = span.tex.replace(/\\label\{[^}]*\}/g, '');
  if (span.open.startsWith('align')) return { tex: `\\begin{aligned}${body}\\end{aligned}`, display: true };
  if (span.open.startsWith('gather')) return { tex: `\\begin{gathered}${body}\\end{gathered}`, display: true };
  return { tex: body, display: span.open !== '$' && span.open !== '\\(' };
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

export function checkLatex(text: string): MathProblem[] {
  const problems: MathProblem[] = [];
  for (const span of mathSpans(text)) {
    const line = lineOf(text, span.start);
    const math = span.tex.trim();
    if (!span.closed) {
      problems.push({ line, math: math.slice(0, 80), error: `the ${span.open} here is never closed` });
      continue;
    }
    if (span.open === '$' && span.tex.includes('\n\n')) {
      problems.push({ line, math: math.slice(0, 80), error: 'inline math runs over a blank line, a $ is probably missing or one too many' });
      continue;
    }
    const { tex, display } = source(span);
    try {
      katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push({ line, math, error: message.replace(/^KaTeX parse error: /, '') });
    }
  }
  return problems;
}
