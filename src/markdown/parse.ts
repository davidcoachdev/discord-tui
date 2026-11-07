export type MdNode =
  | { type: "text"; text: string }
  | { type: "bold" | "italic" | "underline" | "strike" | "spoiler" | "quote"; children: MdNode[] }
  | { type: "code"; text: string }
  | { type: "codeblock"; lang: string | null; text: string }
  | { type: "mention"; kind: "user" | "channel" | "role" | "everyone" | "here"; id: string | null }
  | { type: "emoji"; name: string; id: string; animated: boolean }
  | { type: "link"; url: string; label: string | null }
  | { type: "timestamp"; unix: number; style: string | null };

type Wrap = "bold" | "italic" | "underline" | "strike" | "spoiler";

// Orden importa: los marcadores dobles antes que los simples.
const WRAPS: { marker: string; type: Wrap }[] = [
  { marker: "**", type: "bold" },
  { marker: "__", type: "underline" },
  { marker: "~~", type: "strike" },
  { marker: "||", type: "spoiler" },
  { marker: "*", type: "italic" },
  { marker: "_", type: "italic" },
];

const ANGLE: { re: RegExp; build: (m: RegExpExecArray) => MdNode }[] = [
  { re: /^<@!?(\d+)>/, build: (m) => ({ type: "mention", kind: "user", id: m[1]! }) },
  { re: /^<#(\d+)>/, build: (m) => ({ type: "mention", kind: "channel", id: m[1]! }) },
  { re: /^<@&(\d+)>/, build: (m) => ({ type: "mention", kind: "role", id: m[1]! }) },
  { re: /^<(a?):(\w+):(\d+)>/, build: (m) => ({ type: "emoji", name: m[2]!, id: m[3]!, animated: m[1] === "a" }) },
  { re: /^<t:(-?\d+)(?::([tTdDfFR]))?>/, build: (m) => ({ type: "timestamp", unix: Number(m[1]), style: m[2] ?? null }) },
  { re: /^<(https?:\/\/[^\s>]+)>/, build: (m) => ({ type: "link", url: m[1]!, label: null }) },
];

const MASKED_LINK = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/;
const BARE_URL = /^https?:\/\/[^\s<]+/;
const URL_TRAILING = /[.,:;!?"')\]]+$/;
const WORD = /[\p{L}\p{N}]/u;

function isPunct(ch: string | undefined): boolean {
  return ch !== undefined && !/[\p{L}\p{N}\s]/u.test(ch);
}

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch);
}

/** Busca el cierre de un run de `count` backticks; devuelve el índice o -1. */
function findBackticks(src: string, from: number, end: number, count: number): number {
  const run = "`".repeat(count);
  let j = src.indexOf(run, from);
  while (j !== -1 && j + count <= end) {
    if (src[j + count] !== "`" && src[j - 1] !== "`") return j;
    j = src.indexOf(run, j + 1);
  }
  return -1;
}

function backtickRun(src: string, at: number, end: number): number {
  let n = 0;
  while (at + n < end && src[at + n] === "`") n += 1;
  return n;
}

function closes(src: string, j: number, end: number, marker: string): boolean {
  if (!src.startsWith(marker, j) || j + marker.length > end) return false;
  const after = j + marker.length < end ? src[j + marker.length] : undefined;
  if (marker === "**" || marker === "__") return after !== marker[0];
  if (marker === "*") return src[j - 1] !== " " && after !== "*";
  if (marker === "_") return after !== "_" && !isWord(after);
  return true;
}

/** Índice del marcador de cierre (contenido no vacío), saltando escapes y código; -1 si no cierra. */
function findClose(src: string, from: number, end: number, marker: string): number {
  let j = from;
  while (j < end) {
    const ch = src[j]!;
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "`") {
      const n = Math.min(backtickRun(src, j, end), 3);
      const close = findBackticks(src, j + n, end, n);
      j = close === -1 ? j + 1 : close + n;
      continue;
    }
    if (j > from && closes(src, j, end, marker)) return j;
    // Un doble marcador dentro de uno simple es anidado: se saltea entero.
    if (marker.length === 1 && src[j + 1] === marker && ch === marker) {
      j += 2;
      continue;
    }
    j += 1;
  }
  return -1;
}

function canOpen(src: string, i: number, end: number, marker: string): boolean {
  const after = i + marker.length < end ? src[i + marker.length] : undefined;
  if (after === undefined) return false;
  if (marker === "*") return !/\s/.test(after);
  if (marker === "_") return !isWord(src[i - 1]);
  return true;
}

function parseRange(src: string, start: number, end: number, top: boolean): MdNode[] {
  const out: MdNode[] = [];
  let text = "";
  const flush = (): void => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  const push = (node: MdNode): void => {
    flush();
    out.push(node);
  };

  let i = start;
  while (i < end) {
    const ch = src[i]!;

    if (ch === "\\" && isPunct(src[i + 1]) && i + 1 < end) {
      text += src[i + 1];
      i += 2;
      continue;
    }

    if (top && (i === start || src[i - 1] === "\n") && ch === ">") {
      if (src.startsWith(">>> ", i)) {
        push({ type: "quote", children: parseRange(src, i + 4, end, false) });
        i = end;
        continue;
      }
      if (src.startsWith("> ", i)) {
        const nl = src.indexOf("\n", i);
        const lineEnd = nl === -1 || nl > end ? end : nl;
        push({ type: "quote", children: parseRange(src, i + 2, lineEnd, false) });
        i = lineEnd;
        continue;
      }
    }

    if (ch === "`") {
      const run = backtickRun(src, i, end);
      if (run >= 3) {
        const close = findBackticks(src, i + 3, end, 3);
        if (close !== -1) {
          let body = src.slice(i + 3, close);
          let lang: string | null = null;
          const nl = body.indexOf("\n");
          const first = nl === -1 ? "" : body.slice(0, nl);
          if (/^[\w+#.-]+$/.test(first)) {
            lang = first;
            body = body.slice(nl + 1);
          } else if (body.startsWith("\n")) {
            body = body.slice(1);
          }
          if (body.endsWith("\n")) body = body.slice(0, -1);
          push({ type: "codeblock", lang, text: body });
          i = close + 3;
          continue;
        }
      }
      const n = Math.min(run, 2);
      const close = findBackticks(src, i + n, end, n);
      if (close > i + n) {
        push({ type: "code", text: src.slice(i + n, close) });
        i = close + n;
        continue;
      }
      text += "`".repeat(run);
      i += run;
      continue;
    }

    if (ch === "<") {
      const rest = src.slice(i, end);
      const hit = ANGLE.map(({ re, build }) => {
        const m = re.exec(rest);
        return m ? { node: build(m), len: m[0].length } : null;
      }).find((candidate) => candidate !== null);
      if (hit) {
        push(hit.node);
        i += hit.len;
        continue;
      }
    }

    if (ch === "@") {
      if (src.startsWith("@everyone", i) && i + 9 <= end) {
        push({ type: "mention", kind: "everyone", id: null });
        i += 9;
        continue;
      }
      if (src.startsWith("@here", i) && i + 5 <= end) {
        push({ type: "mention", kind: "here", id: null });
        i += 5;
        continue;
      }
    }

    if (ch === "[") {
      const m = MASKED_LINK.exec(src.slice(i, end));
      if (m) {
        push({ type: "link", url: m[2]!, label: m[1]! });
        i += m[0].length;
        continue;
      }
    }

    if (ch === "h" && !isWord(src[i - 1])) {
      const m = BARE_URL.exec(src.slice(i, end));
      if (m) {
        const url = m[0].replace(URL_TRAILING, "");
        if (/^https?:\/\/./.test(url)) {
          push({ type: "link", url, label: null });
          i += url.length;
          continue;
        }
      }
    }

    const wrap = WRAPS.find(({ marker }) => src.startsWith(marker, i) && i + marker.length <= end);
    if (wrap) {
      const { marker, type } = wrap;
      const inner = i + marker.length;
      const close = canOpen(src, i, end, marker) ? findClose(src, inner, end, marker) : -1;
      if (close !== -1) {
        push({ type, children: parseRange(src, inner, close, false) });
        i = close + marker.length;
        continue;
      }
      text += marker;
      i += marker.length;
      continue;
    }

    text += ch;
    i += 1;
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): MdNode[] {
  return parseRange(src, 0, src.length, true);
}

export interface PlainResolvers {
  user?(id: string): string;
  channel?(id: string): string;
  role?(id: string): string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatTimestamp(unix: number, style: string | null): string {
  const ms = unix * 1000;
  if (style === "R") {
    const diff = Math.round((Date.now() - ms) / 60000);
    const abs = Math.abs(diff);
    const amount = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} d`;
    return diff >= 0 ? `hace ${amount}` : `en ${amount}`;
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(unix);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function plainText(nodes: MdNode[], resolve: PlainResolvers = {}): string {
  return nodes
    .map((node): string => {
      switch (node.type) {
        case "text":
        case "code":
        case "codeblock":
          return node.text;
        case "mention":
          if (node.kind === "everyone" || node.kind === "here") return `@${node.kind}`;
          if (node.kind === "user") return `@${(node.id && resolve.user?.(node.id)) || "usuario"}`;
          if (node.kind === "channel") return `#${(node.id && resolve.channel?.(node.id)) || "canal"}`;
          return `@${(node.id && resolve.role?.(node.id)) || "rol"}`;
        case "emoji":
          return `:${node.name}:`;
        case "link":
          return node.label ?? node.url;
        case "timestamp":
          return formatTimestamp(node.unix, node.style);
        default:
          return plainText(node.children, resolve);
      }
    })
    .join("");
}
