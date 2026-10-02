// reading a handwritten page with claude: haiku reads the page and the zoomed math,
// then katex checks every math span of what came back.

import Anthropic from '@anthropic-ai/sdk';
import { checkLatex, type MathProblem } from './latex.js';
import { transcriptionPrompt, type Format } from './prompt.js';

export const FIRST_MODEL = 'claude-haiku-5-5';

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
  // the layout text of the page, as a hint where lines and blocks are
  layout: string;
}

export interface Transcription {
  text: string;
  model: string;
  problems: MathProblem[];
  steps: string[];
}

export function anthropicAsk(client = new Anthropic()): Ask {
  return async (model, pictures, prompt) => {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const picture of pictures) {
      content.push({ type: 'text', text: picture.label });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: picture.png } });
    }
    content.push({ type: 'text', text: prompt });
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }];
    const response = await client.beta.messages.create({ model, max_tokens: 16000, messages });
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

export async function transcribe(input: TranscribeInput, ask: Ask): Promise<Transcription> {
  const prompt = `${transcriptionPrompt(input.format)}\n\nWhere things are on the page, found from the pen strokes:\n${input.layout}`;
  const text = unfence(await ask(FIRST_MODEL, [input.page, ...input.crops], prompt));
  const problems = checkLatex(text);
  const steps = [`${FIRST_MODEL} read the page with ${input.crops.length} zoomed crops: ${summary(problems)}`];
  return { text, model: FIRST_MODEL, problems, steps };
}

function summary(problems: MathProblem[]): string {
  if (problems.length === 0) return 'every math span parses';
  return `${problems.length} math span${problems.length === 1 ? ' does' : 's do'} not parse`;
}
