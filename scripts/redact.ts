import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { createRedactor, trimReady } from "../src/security/redact";
import { findTokenLike } from "../src/security/token-pattern";

interface Options {
  root: string;
  out: string;
  trim: number | null;
}

function parseArgs(argv: string[]): Options {
  let root = "";
  let out = "";
  let trim: number | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") root = argv[++index] ?? "";
    else if (arg === "--out") out = argv[++index] ?? "";
    else if (arg === "--trim") trim = Number(argv[++index]);
  }
  if (!root || !out) {
    console.error("uso: bun scripts/redact.ts --root <dir> --out <dir> [--trim N]");
    process.exit(1);
  }
  return { root, out, trim };
}

async function collect(dir: string, out: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (path === out || path.startsWith(out + sep)) continue;
    if (entry.isDirectory()) found.push(...(await collect(path, out)));
    else if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".curl.txt"))) found.push(path);
  }
  return found;
}

async function main(): Promise<void> {
  const { root, out, trim } = parseArgs(process.argv.slice(2));
  const files = (await collect(root, out)).sort();
  const redactor = createRedactor();
  const outputs: { path: string; rel: string; content: string }[] = [];

  for (const file of files) {
    const rel = relative(root, file);
    const raw = await readFile(file, "utf8");
    let value: unknown;

    if (file.endsWith(".curl.txt")) {
      value = redactor.redactCurl(raw);
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.error(`FALLA: ${rel} no es JSON`);
        process.exit(2);
      }
      const type = (parsed as { t?: unknown } | null)?.t;
      const isReady = typeof type === "string" && type.startsWith("READY");
      value = redactor.redactJson(isReady && trim !== null ? trimReady(parsed, trim) : parsed);
    }

    const outRel = file.endsWith(".curl.txt") ? rel.slice(0, -".curl.txt".length) + ".json" : rel;
    outputs.push({ path: join(out, outRel), rel: outRel, content: JSON.stringify(value, null, 2) + "\n" });
  }

  for (const output of outputs) {
    if (findTokenLike(output.content).length > 0) {
      console.error(`FALLA: ${output.rel} todavía tiene algo con forma de token`);
      process.exit(2);
    }
  }

  for (const output of outputs) {
    await mkdir(dirname(output.path), { recursive: true });
    await writeFile(output.path, output.content);
    console.log(`ok ${output.rel}`);
  }
}

if (import.meta.main) await main();
