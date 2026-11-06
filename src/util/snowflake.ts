export function compareSnowflakes(a: string, b: string): -1 | 0 | 1 {
  const left = BigInt(a);
  const right = BigInt(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function generateNonce(now = Date.now()): string {
  return ((BigInt(now) - 1420070400000n) << 22n).toString();
}
