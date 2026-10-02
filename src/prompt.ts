// the transcription instructions. the server sends them with the page when it reads a
// page itself, and hands them to the agent (tool or mcp prompt) when it cannot.

export type Format = 'latex' | 'markdown';

export function transcriptionPrompt(format: Format): string {
  const structure =
    format === 'latex'
      ? 'Keep the line and block structure: headings as \\section*{...}, derivations over several lines as an align* environment, lists as itemize.'
      : 'Keep the line and block structure: headings as # headings, derivations over several lines as one $$ block with \\begin{aligned}, lists as - lists.';
  const output =
    format === 'latex'
      ? 'Output only the LaTeX body, without a preamble, \\documentclass or \\begin{document}, and nothing else.'
      : 'Write markdown with $...$ for math inside a line and $$...$$ for math on its own lines. Output only the markdown, nothing else.';
  return [
    'The image is a handwritten page. Transcribe it exactly as it is written.',
    'Do not correct or complete anything: no math, no text and no spelling. A wrong sign, a missing step or a typo stays as it is.',
    structure,
    'Mark anything you cannot read as [?].',
    'Leave drawings out and write \\includegraphics{drawing-1}, \\includegraphics{drawing-2} and so on where one is.',
    output
  ].join('\n');
}
