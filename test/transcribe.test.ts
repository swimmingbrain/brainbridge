import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropicAsk, FALLBACK_MODEL, FIRST_MODEL, transcribe, unfence, type Ask, type TranscribeInput } from '../src/transcribe.js';

const good = '\\section*{Chain rule}\n\\begin{align*}\nf(x) &= \\frac{a}{b} \\\\\n&= c\n\\end{align*}';
const broken = '\\section*{Chain rule}\n$f(x) = \\frac{a}{$';

// a model that answers from a list and remembers what it was asked
function fakeModel(answers: string[]) {
  const calls: { model: string; pictures: string[]; prompt: string }[] = [];
  const ask: Ask = async (model, pictures, prompt) => {
    calls.push({ model, pictures: pictures.map((p) => p.label), prompt });
    return answers[calls.length - 1] ?? '';
  };
  return { ask, calls };
}

function input(): TranscribeInput & { zooms: number } {
  const result = {
    zooms: 0,
    format: 'latex' as const,
    page: { label: 'page 0', png: 'cGFnZQ==' },
    crops: [{ label: 'crop 1', png: 'Y3JvcA==' }],
    zoom: async () => {
      result.zooms += 1;
      return [{ label: 'sharp 1', png: 'c2hhcnA=' }];
    },
    layout: 'block 70, 190, 260, 114'
  };
  return result;
}

describe('transcribe', () => {
  it('takes the first reading when every formula parses', async () => {
    const { ask, calls } = fakeModel([good]);
    const job = input();
    const result = await transcribe(job, ask);
    expect(result).toMatchObject({ text: good, model: FIRST_MODEL, problems: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].pictures).toEqual(['page 0', 'crop 1']);
    expect(calls[0].prompt).toContain('exactly as it is written');
    expect(calls[0].prompt).toContain('block 70, 190, 260, 114');
    expect(job.zooms).toBe(0);
  });

  it('reads failing spans again on sharper crops', async () => {
    const { ask, calls } = fakeModel([broken, good]);
    const job = input();
    const result = await transcribe(job, ask);
    expect(result).toMatchObject({ text: good, model: FIRST_MODEL, problems: [] });
    expect(calls.map((c) => c.model)).toEqual([FIRST_MODEL, FIRST_MODEL]);
    expect(calls[1].pictures).toEqual(['page 0', 'sharp 1']);
    expect(calls[1].prompt).toContain('\\frac{a}{');
    expect(job.zooms).toBe(1);
  });

  it('hands a page that still fails to the bigger model', async () => {
    const { ask, calls } = fakeModel([broken, broken, good]);
    const result = await transcribe(input(), ask);
    expect(result).toMatchObject({ text: good, model: FALLBACK_MODEL, problems: [] });
    expect(calls.map((c) => c.model)).toEqual([FIRST_MODEL, FIRST_MODEL, FALLBACK_MODEL]);
    expect(result.steps).toHaveLength(3);
  });

  it('keeps the best reading and says what still fails', async () => {
    const { ask } = fakeModel([broken, broken, `${broken}\n$\\oops$`]);
    const result = await transcribe(input(), ask);
    expect(result.model).toBe(FIRST_MODEL);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].line).toBe(2);
  });

  it('takes the text out of a code fence', () => {
    expect(unfence('```latex\n$x$\n```')).toBe('$x$');
    expect(unfence('  $x$ \n')).toBe('$x$');
  });

  it('sends the pictures as base64 png blocks, with the server fallback only for sonnet', async () => {
    const requests: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          create: async (request: Record<string, unknown>) => {
            requests.push(request);
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: '$x$' }] };
          }
        }
      }
    } as unknown as Anthropic;
    const ask = anthropicAsk(client);
    expect(await ask(FIRST_MODEL, [{ label: 'page 0', png: 'cGFnZQ==' }], 'read it')).toBe('$x$');
    await ask(FALLBACK_MODEL, [], 'read it');
    expect(requests[0]).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 16000 });
    expect(requests[0].fallbacks).toBeUndefined();
    const content = (requests[0].messages as { content: unknown[] }[])[0].content;
    expect(content).toEqual([
      { type: 'text', text: 'page 0' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'cGFnZQ==' } },
      { type: 'text', text: 'read it' }
    ]);
    expect(requests[1]).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
  });

  it('turns a refusal into an error', async () => {
    const client = {
      beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } }
    } as unknown as Anthropic;
    await expect(anthropicAsk(client)(FIRST_MODEL, [], 'read it')).rejects.toThrow(/declined/);
  });
});
