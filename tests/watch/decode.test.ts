import { expect, test } from "bun:test";

import { spawnClean } from "../../src/proc/spawn";
import { createH264Decoder, fitBox } from "../../src/watch/decode";
import { splitAnnexB } from "../../src/watch/h264";

const hasFfmpeg = Bun.which("ffmpeg") !== null;

/** H264 sintético (lavfi, rojo puro) cortado en access units por AUD, como las arma el depacketizer. */
async function syntheticAccessUnits(size: string, frames: number): Promise<Uint8Array[]> {
  const ff = spawnClean(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=red:size=${size}:rate=30`, "-frames:v", String(frames),
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-bf", "0", "-g", "10", "-pix_fmt", "yuv420p",
      "-x264-params", "aud=1", "-f", "h264", "pipe:1"],
    { stdout: "pipe" },
  );
  const es = new Uint8Array(await new Response(ff.stdout as ReadableStream).arrayBuffer());
  const aus: Uint8Array[] = [];
  let cur: Uint8Array[] = [];
  const flush = () => cur.length && aus.push(Buffer.concat(cur.flatMap((n) => [new Uint8Array([0, 0, 0, 1]), n])));
  for (const nal of splitAnnexB(es)) {
    if ((nal[0]! & 0x1f) === 9) {
      flush();
      cur = [];
    }
    cur.push(nal);
  }
  flush();
  return aus;
}

test("fitBox keeps aspect, never upscales, and returns even sizes", () => {
  expect(fitBox(1280, 720, 640, 360)).toEqual({ width: 640, height: 360 });
  expect(fitBox(1920, 1080, 500, 500)).toEqual({ width: 500, height: 280 });
  expect(fitBox(320, 240, 1000, 1000)).toEqual({ width: 320, height: 240 });
});

test.skipIf(!hasFfmpeg)("decodes synthetic H264 to RGBA fit to the box, only scaling the frames it shows", async () => {
  const aus = await syntheticAccessUnits("640x480", 12);
  expect(aus.length).toBe(12);
  const dec = await createH264Decoder(320, 320);
  const shown = [];
  for (let i = 0; i < aus.length; i++) {
    const f = await dec.decode(aus[i]!, i % 3 === 0);
    if (f) shown.push({ w: f.width, h: f.height, px: [...f.rgba.subarray(0, 4)], len: f.rgba.length });
  }
  dec.close();
  expect(shown.length).toBe(4);
  expect(shown[0]).toMatchObject({ w: 320, h: 240, len: 320 * 240 * 4 });
  const [r, g, b, a] = shown[0]!.px;
  expect(r!).toBeGreaterThan(200);
  expect(g!).toBeLessThan(60);
  expect(b!).toBeLessThan(60);
  expect(a).toBe(255);
  expect(await dec.decode(aus[0]!, true)).toBeNull(); // cerrado
});

test.skipIf(!hasFfmpeg)("garbage input never throws and the decoder recovers on the next keyframe", async () => {
  const aus = await syntheticAccessUnits("320x240", 3);
  const dec = await createH264Decoder(320, 240);
  expect(await dec.decode(new Uint8Array([0, 0, 0, 1, 0x65, 1, 2, 3, 4]), true)).toBeNull();
  const f = await dec.decode(aus[0]!, true);
  expect(f?.width).toBe(320);
  dec.close();
});
