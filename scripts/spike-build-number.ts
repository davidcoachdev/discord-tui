const APP_URL = "https://discord.com/app";
const BUILD_RE = /build(?:Number|_number)["']?\s*[:=]\s*["']?(\d{5,7})/i;
const ASSET_RE = /<script[^>]+src="(\/assets\/[^"]+\.js)"/g;
const BUDGET_MS = 10_000;

const started = Date.now();

async function findBuildNumber(): Promise<number | null> {
  const response = await fetch(APP_URL, { signal: AbortSignal.timeout(BUDGET_MS) });
  if (!response.ok) throw new Error(`GET ${APP_URL} -> ${response.status}`);
  const html = await response.text();

  const inline = html.match(BUILD_RE);
  if (inline?.[1]) return Number(inline[1]);

  const assets = [...html.matchAll(ASSET_RE)].map((match) => new URL(match[1]!, APP_URL).href);
  for (const url of assets) {
    if (Date.now() - started > BUDGET_MS) break;
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) }).catch(() => null);
    if (!response?.ok) continue;
    const hit = (await response.text()).match(BUILD_RE);
    if (hit?.[1]) return Number(hit[1]);
  }
  return null;
}

const value = await findBuildNumber();
if (value === null) {
  console.error("no build number found");
  process.exit(1);
}
console.log(value);

export {};
