// reading a handwritten page through the anthropic api: haiku reads the page and the zoomed math,
// katex checks every math span, haiku looks at the spans that fail once more on
// sharper crops, and sonnet reads a page that still fails.

import type Anthropic from '@anthropic-ai/sdk';
import { checkLatex, type MathProblem } from './latex.js';
import { transcriptionPrompt, type Format } from './prompt.js';

export const FIRST_MODEL = 'claude-haiku-5-5';
export const FALLBACK_MODEL = 'claude-sonnet-5-5';

export interface Picture {
  label: string;
  png: string;
}

// one request: the pictures in order, each after its label, then the instructions
export type Ask = (model: string, pictures: Picture[], prompt: string) => Promise<string>;

export interface TranscribeInput {
  format: Format;
  page: Picture;
  // the math looked at closer, sent with the page
  crops: Picture[];
  // sharper crops for a second look, only made when a span fails
  zoom: () => Promise<Picture[]>;
  // the layout text of the page, as a hint where lines and blocks are
  layout: string;
}

export interface Transcription {
  text: string;
  model: string;
  problems: MathProblem[];
  steps: string[];
}

export function anthropicAsk(client?: Anthropic): Ask {
  let loaded = client;
  return async (model, pictures, prompt) => {
    // the sdk is loaded on the first page read, the server starts faster without it
    loaded ??= new (await import('@anthropic-ai/sdk')).default();
    const api = loaded;
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const picture of pictures) {
      content.push({ type: 'text', text: picture.label });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: picture.png } });
    }
    content.push({ type: 'text', text: prompt });
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }];
    // sonnet may hand a declined request to another model on the server; haiku has no such fallback
    const response =
      model === FALLBACK_MODEL
        ? await api.beta.messages.create({
            model,
            max_tokens: 16000,
            messages,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default'
          })
        : await api.beta.messages.create({ model, max_tokens: 16000, messages });
    if (response.stop_reason === 'refusal') throw new Error(`${model} declined to read the page`);
    const text = response.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    if (response.stop_reason === 'max_tokens') throw new Error(`${model} ran out of room before the end of the page`);
    return text;
  };
}

// models like to wrap their answer in a code fence, the text inside is what counts
export function unfence(text: string): string {
  const fenced = /^\s*```[a-z]*\n([\s\S]*?)\n```\s*$/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

function rereadPrompt(format: Format, text: string, problems: MathProblem[]): string {
  const list = problems.map((p) => `- line ${p.line}: ${p.math}\n  KaTeX says: ${p.error}`).join('\n');
  return [
    'This is a transcription of the handwritten page in the first image:',
    '',
    text,
    '',
    'These math spans of it do not parse:',
    list,
    '',
    'Look at them again in the zoomed crops after the page and read them from the handwriting once more.',
    'Fix what was misread or where the LaTeX itself broke, but still do not correct or complete the math.',
    'Answer with the whole transcription again, with the same rules:',
    '',
    transcriptionPrompt(format)
  ].join('\n');
}

export async function transcribe(input: TranscribeInput, ask: Ask): Promise<Transcription> {
  const prompt = `${transcriptionPrompt(input.format)}\n\nWhere things are on the page, found from the pen strokes:\n${input.layout}`;
  const steps: string[] = [];
  let model = FIRST_MODEL;
  let text = unfence(await ask(FIRST_MODEL, [input.page, ...input.crops], prompt));
  let problems = checkLatex(text);
  steps.push(`${FIRST_MODEL} read the page with ${input.crops.length} zoomed crops: ${summary(problems)}`);
  if (problems.length === 0) return { text, model, problems, steps };

  // once more on sharper crops, only for the spans that failed
  const zoomed = await input.zoom();
  const again = unfence(await ask(FIRST_MODEL, [input.page, ...zoomed], rereadPrompt(input.format, text, problems)));
  const againProblems = checkLatex(again);
  steps.push(`${FIRST_MODEL} read the failing spans again on ${zoomed.length} sharper crops: ${summary(againProblems)}`);
  if (againProblems.length <= problems.length) {
    text = again;
    problems = againProblems;
  }
  if (problems.length === 0) return { text, model, problems, steps };

  // the page is hard to read, the bigger model takes it from the start
  const second = unfence(await ask(FALLBACK_MODEL, [input.page, ...zoomed], prompt));
  const secondProblems = checkLatex(second);
  steps.push(`${FALLBACK_MODEL} read the page: ${summary(secondProblems)}`);
  if (secondProblems.length <= problems.length) {
    text = second;
    problems = secondProblems;
    model = FALLBACK_MODEL;
  }
  return { text, model, problems, steps };
}

function summary(problems: MathProblem[]): string {
  if (problems.length === 0) return 'every math span parses';
  return `${problems.length} math span${problems.length === 1 ? ' does' : 's do'} not parse`;
}
