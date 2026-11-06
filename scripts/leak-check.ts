import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { sessionPath, stateDir } from "../src/config/paths";

export interface LeakCheckOptions {
  sessionFile: string;
  scanDirs: string[];
  scanFiles?: string[];
}

export interface LeakCheckResult {
  filesScanned: number;
  matches: number;
  files: string[];
}

async function listFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function tokenFromSession(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { token?: unknown }).token === "string") {
      return (parsed as { token: string }).token;
    }
  } catch {
    // sin JSON válido no hay token que buscar
  }
  return "";
}

export async function leakCheck(opts: LeakCheckOptions): Promise<LeakCheckResult> {
  const token = tokenFromSession(await readFile(opts.sessionFile, "utf8"));
  if (token.length === 0) throw new Error("session has no token");

  const candidates = new Set<string>(opts.scanFiles ?? []);
  for (const dir of opts.scanDirs) {
    for (const file of await listFiles(dir)) candidates.add(file);
  }
  candidates.delete(opts.sessionFile);

  const files: string[] = [];
  let filesScanned = 0;
  for (const file of candidates) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    filesScanned += 1;
    if (content.includes(token)) files.push(file);
  }
  return { filesScanned, matches: files.length, files };
}

async function repoFiles(): Promise<string[]> {
  try {
    const proc = Bun.spawn(["git", "ls-files", "-z"], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return [];
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

async function cli(): Promise<void> {
  try {
    const result = await leakCheck({
      sessionFile: sessionPath(),
      scanDirs: [stateDir()],
      scanFiles: await repoFiles(),
    });
    if (result.matches === 0) {
      console.log(`OK: 0 coincidencias en ${result.filesScanned} archivos`);
      process.exit(0);
    }
    console.log(`FALLA: ${result.matches} coincidencias en: ${result.files.join(", ")}`);
    process.exit(1);
  } catch {
    console.error("leak-check no pudo leer la sesión; ¿estás logueado?");
    process.exit(1);
  }
}

if (import.meta.main) await cli();
