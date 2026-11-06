export function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.length > 0 ? [shapeOf(value[0])] : [];
  if (value === null) return "null";
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = shapeOf(source[key]);
    return out;
  }
  return typeof value;
}
