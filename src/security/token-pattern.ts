export const TOKEN_PATTERNS: RegExp[] = [
  /[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}/g,
  /mfa\.[A-Za-z0-9_-]{20,}/g,
];

export function findTokenLike(text: string): string[] {
  const hits: { index: number; value: string }[] = [];
  for (const pattern of TOKEN_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      hits.push({ index: match.index ?? 0, value: match[0] });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  const unique: string[] = [];
  for (const hit of hits) {
    if (!unique.includes(hit.value)) unique.push(hit.value);
  }
  return unique;
}
