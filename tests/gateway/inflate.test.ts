import { expect, test } from "bun:test";
import { createDeflate, constants } from "node:zlib";

import { createZlibStreamInflater } from "../../src/gateway/inflate";

async function deflatedChunks(payloads: string[]): Promise<Buffer[]> {
  const deflate = createDeflate();
  const parts: Buffer[] = [];
  deflate.on("data", (chunk: Buffer) => parts.push(chunk));
  const chunks: Buffer[] = [];
  for (const payload of payloads) {
    deflate.write(payload);
    await new Promise<void>((resolve) => deflate.flush(constants.Z_SYNC_FLUSH, () => resolve()));
    chunks.push(Buffer.concat(parts));
    parts.length = 0;
  }
  deflate.destroy();
  return chunks;
}

test("inflater returns null until the 00 00 ff ff suffix arrives", async () => {
  const [chunk] = await deflatedChunks([JSON.stringify({ op: 10 })]);
  const half = Math.floor(chunk!.length / 2);
  const inflater = createZlibStreamInflater();
  expect(inflater.push(chunk!.subarray(0, half))).toBeNull();
  const text = inflater.push(chunk!.subarray(half));
  expect(JSON.parse(text!)).toEqual({ op: 10 });
});

test("inflater keeps context across messages", async () => {
  const chunks = await deflatedChunks([JSON.stringify({ op: 1 }), JSON.stringify({ op: 2 })]);
  const inflater = createZlibStreamInflater();
  expect(JSON.parse(inflater.push(chunks[0]!)!)).toEqual({ op: 1 });
  expect(JSON.parse(inflater.push(chunks[1]!)!)).toEqual({ op: 2 });
});
