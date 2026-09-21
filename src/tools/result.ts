// the shapes every tool answers with. errors are results with isError, never thrown,
// so the agent reads the message and can tell the user what to do.

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
  content: Content[];
  isError?: boolean;
  [key: string]: unknown;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function text(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

export function fail(error: unknown): ToolResult {
  return { isError: true, content: [{ type: 'text', text: message(error) }] };
}

export function image(png: string, caption: string): ToolResult {
  return {
    content: [
      { type: 'image', data: png, mimeType: 'image/png' },
      { type: 'text', text: caption }
    ]
  };
}
