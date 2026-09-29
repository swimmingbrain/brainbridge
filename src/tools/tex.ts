// the TeXbrain tools, and the katex check that both apps' work goes through

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Bridge } from '../server.js';
import { checkLatex } from '../latex.js';
import { text } from './result.js';

export function registerTexTools(server: McpServer, bridge: Bridge): void {
  server.registerTool(
    'latex_check',
    {
      title: 'Check LaTeX math',
      description:
        'Parse every math span of a LaTeX or markdown text with KaTeX: $...$, $$...$$, \\(...\\), \\[...\\] and the bodies of ' +
        'align, equation and gather. Returns "ok", or each span that fails with its line and the error. ' +
        'Use it on a transcription or before writing math into a project.',
      inputSchema: { text: z.string().describe('the LaTeX or markdown text') }
    },
    async ({ text: source }) => {
      const problems = checkLatex(source);
      return text(problems.length === 0 ? 'ok' : problems);
    }
  );
}
