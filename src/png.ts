// just enough of the png format to tell a png from anything else and read its size

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Buffer): boolean {
  return bytes.length > 24 && SIGNATURE.every((b, i) => bytes[i] === b);
}

// the width and height sit in the first chunk (IHDR), right after the signature
export function pngSize(base64: string): { width: number; height: number } | null {
  const head = Buffer.from(base64.slice(0, 48), 'base64');
  if (!isPng(head)) return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}
