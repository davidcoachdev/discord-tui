import { readFile, stat } from "node:fs/promises";

import { findTokenLike } from "./token-pattern";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export async function scanFiles(paths: string[]): Promise<string[]> {
  const offenders: string[] = [];
  for (const path of paths) {
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_SIZE) continue;
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      continue;
    }
    if (bytes.includes(0)) continue;
    bytes
      .toString("utf8")
      .split("\n")
      .forEach((line, index) => {
        if (findTokenLike(line).length > 0) offenders.push(`${path}:${index + 1}`);
      });
  }
  return offenders;
}
