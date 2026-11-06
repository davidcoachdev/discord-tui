import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadSession } from "../src/auth/session";
import { fetchBuildNumber } from "../src/client-props/build-number";
import { createClientProps } from "../src/client-props/props";
import { createZlibStreamInflater } from "../src/gateway/inflate";

const DEFAULT_URL = "wss://gateway.discord.gg/?v=9&encoding=json&compress=zlib-stream";
const CAPTURED = new Set([
  "READY",
  "READY_SUPPLEMENTAL",
  "MESSAGE_CREATE",
  "MESSAGE_UPDATE",
  "MESSAGE_REACTION_ADD",
  "TYPING_START",
  "PRESENCE_UPDATE",
  "GUILD_MEMBER_LIST_UPDATE",
  "VOICE_STATE_UPDATE",
  "VOICE_SERVER_UPDATE",
  "CHANNEL_UNREAD_UPDATE",
  "MESSAGE_ACK",
]);

interface Options {
  out: string;
  capabilities: number;
  op37: string | null;
  voice: [string, string] | null;
  url: string;
}

function parseArgs(argv: string[]): Options {
  let out = "";
  let capabilities = 0;
  let op37: string | null = null;
  let voice: [string, string] | null = null;
  let url = DEFAULT_URL;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") out = argv[++index] ?? "";
    else if (arg === "--capabilities") capabilities = Number(argv[++index]);
    else if (arg === "--op37") op37 = argv[++index] ?? null;
    else if (arg === "--voice") voice = [argv[++index] ?? "", argv[++index] ?? ""];
    else if (arg === "--url") url = argv[++index] ?? url;
  }

  if (!out || !Number.isFinite(capabilities) || capabilities <= 0) {
    console.error(
      "uso: bun scripts/capture-gateway.ts --out <dir> --capabilities <n> [--op37 <archivo>] [--voice <guild> <channel>]",
    );
    process.exit(1);
  }
  return { out, capabilities, op37, voice, url };
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const session = await loadSession();
  if (session === null) {
    console.error("sin sesión: logueate primero con bun run dev");
    process.exit(1);
  }

  const buildNumber = session.buildNumber ?? (await fetchBuildNumber({ fetch })).value;
  const props = createClientProps({ buildNumber });
  const inflater = createZlibStreamInflater();
  const counts = new Map<string, number>();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let socket: WebSocket | null = null;

  const send = (payload: unknown): void => {
    try {
      socket?.send(JSON.stringify(payload));
    } catch {
      // el socket ya cerró
    }
  };

  async function onDispatch(message: any): Promise<void> {
    if (message.t === "VOICE_SERVER_UPDATE" && opts.voice) {
      send({ op: 4, d: { guild_id: opts.voice[0], channel_id: null, self_mute: false, self_deaf: false } });
    }
    if (typeof message.t !== "string" || !CAPTURED.has(message.t)) return;

    const next = (counts.get(message.t) ?? 0) + 1;
    counts.set(message.t, next);
    if (next > 3) return;

    await mkdir(opts.out, { recursive: true });
    await writeFile(join(opts.out, `${message.t}-${next}.json`), JSON.stringify(message, null, 2) + "\n");
    console.log(`${message.t} ${next}`);
  }

  socket = new WebSocket(opts.url);
  socket.onmessage = (event) => {
    let text: string | null;
    if (typeof event.data === "string") {
      text = event.data;
    } else {
      const bytes = toBytes(event.data);
      text = bytes === null ? null : inflater.push(bytes);
    }
    if (text === null) return;

    let message: any;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }

    if (message.op === 10) {
      send({
        op: 2,
        d: {
          token: session.token.reveal(),
          capabilities: opts.capabilities,
          properties: props.superProperties(),
          presence: { status: "online", since: 0, activities: [], afk: false },
          compress: false,
        },
      });
      const interval = typeof message.d?.heartbeat_interval === "number" ? message.d.heartbeat_interval : 41_250;
      if (heartbeat !== null) clearInterval(heartbeat);
      heartbeat = setInterval(() => send({ op: 1, d: null }), interval);
      return;
    }
    if (message.op === 11) return;
    if (message.op === 0) void onDispatch(message);
  };

  socket.onclose = () => {
    if (heartbeat !== null) clearInterval(heartbeat);
    process.exit(0);
  };

  async function sendOp37(): Promise<void> {
    if (!opts.op37) return;
    const parsed: any = JSON.parse(await readFile(opts.op37, "utf8"));
    send({ op: 37, d: parsed?.d ?? parsed });
  }

  function sendVoiceJoin(): void {
    if (!opts.voice) return;
    send({ op: 4, d: { guild_id: opts.voice[0], channel_id: opts.voice[1], self_mute: false, self_deaf: false } });
  }

  process.stdin.setEncoding("utf8");
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on("data", (key: string) => {
    for (const char of key) {
      if (char === "q") socket?.close(1000);
      else if (char === "o" && opts.op37) void sendOp37().catch(() => {});
      else if (char === "v" && opts.voice) sendVoiceJoin();
    }
  });
}

if (import.meta.main) await main();
