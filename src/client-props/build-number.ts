export const FALLBACK_BUILD_NUMBER = 663810;

const BUILD_NUMBER_RE = /build(?:Number|_number)["']?\s*[:=]\s*["']?(\d{5,7})/i;
const APP_URL = "https://discord.com/app";
const TIMEOUT_MS = 10_000;

export function extractBuildNumber(js: string): number | null {
  const match = js.match(BUILD_NUMBER_RE);
  return match?.[1] ? Number(match[1]) : null;
}

export interface FetchBuildNumberDeps {
  fetch: typeof fetch;
  cached?: number;
}

export async function fetchBuildNumber(
  deps: FetchBuildNumberDeps,
): Promise<{ value: number; source: "live" | "cache" | "fallback" }> {
  try {
    const response = await deps.fetch(APP_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.ok) {
      const html = await response.text();
      const value = extractBuildNumber(html);
      if (value !== null) return { value, source: "live" };
    }
  } catch {
    // sin red: seguimos con el cache o el fallback
  }
  if (deps.cached !== undefined) return { value: deps.cached, source: "cache" };
  return { value: FALLBACK_BUILD_NUMBER, source: "fallback" };
}
