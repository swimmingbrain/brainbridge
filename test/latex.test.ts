import { describe, expect, it } from 'vitest';
import { checkLatex, mathSpans } from '../src/latex.js';

describe('latex check', () => {
  it('finds every kind of math span', () => {
    const text = [
      'Let $f(x) = x^2$ and \\(g\\) be given, it costs \\$5.',
      '$$\\int_0^1 f = \\frac{1}{3}$$',
      '\\[ a + b \\]',
      '\\begin{align*}',
      'f(x) &= (x+1)^2 \\\\',
      '&= x^2 + 2x + 1',
      '\\end{align*}',
      '\\begin{equation}\\label{eq:one} e^{i\\pi} + 1 = 0 \\end{equation}'
    ].join('\n');
    expect(mathSpans(text).map((s) => s.open)).toEqual(['$', '\\(', '$$', '\\[', 'align*', 'equation']);
    expect(mathSpans(text)[0].tex).toBe('f(x) = x^2');
    expect(checkLatex(text)).toEqual([]);
  });

  it('reports a span katex cannot parse, with its line', () => {
    const problems = checkLatex('fine $x$\nthen $\\frac{1}{$ and $\\foo$');
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatchObject({ line: 2, math: '\\frac{1}{' });
    expect(problems[1]).toMatchObject({ line: 2, math: '\\foo' });
    expect(problems[1].error).toMatch(/Undefined control sequence/);
  });

  it('checks the body of an align like latex would', () => {
    const problems = checkLatex('\\begin{align*}\na &= \\left( b \\\\\n&= c\n\\end{align*}');
    expect(problems).toHaveLength(1);
    expect(problems[0].line).toBe(1);
  });

  it('says when a delimiter is never closed', () => {
    expect(checkLatex('a $x + y and more')[0].error).toMatch(/never closed/);
    expect(checkLatex('\\begin{equation} x = 1')[0].error).toMatch(/equation here is never closed/);
    expect(checkLatex('$$ x $')[0].error).toMatch(/\$\$ here is never closed/);
  });

  it('flags inline math that runs over a paragraph', () => {
    expect(checkLatex('costs $5\n\nand then x$')[0].error).toMatch(/blank line/);
  });

  it('leaves code in markdown alone', () => {
    expect(checkLatex('use `$PATH` and\n```\necho $HOME $\n```\nthen $x$')).toEqual([]);
  });
});
