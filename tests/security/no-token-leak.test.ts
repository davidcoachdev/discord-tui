import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanFiles } from "../../src/security/scan";
import { fakeToken } from "../helpers/fake-token";

const root = join(import.meta.dir, "../..");

async function gitList(args: string[]): Promise<string[]> {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return out.split("\0").filter(Boolean);
}

test("no tracked or untracked file in the repo contains a token-like string", async () => {
  const files = [
    ...(await gitList(["ls-files", "-z"])),
    ...(await gitList(["ls-files", "-z", "--others", "--exclude-standard"])),
  ].map((path) => join(root, path));
  const offenders = await scanFiles(files);
  expect(offenders).toEqual([]);
});

test("scanner skips files over 5 MiB and files with NUL bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "discord-tui-scan-"));
  const big = join(dir, "big.txt");
  const bin = join(dir, "bin.dat");
  const text = join(dir, "text.txt");
  try {
    await writeFile(big, "a".repeat(5 * 1024 * 1024 + 1));
    await writeFile(bin, Buffer.concat([Buffer.from([0]), Buffer.from(`x ${fakeToken()}`)]));
    await writeFile(text, `x ${fakeToken()}\n`);
    expect(await scanFiles([big, bin, text])).toEqual([`${text}:1`]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
