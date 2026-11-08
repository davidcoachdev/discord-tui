import type { AppState } from "../store/types";
import { createImageCache } from "./cache";
import { limitFrames, loadSharp, mayAnimate, normalizeDelay, type Animation, type Frame } from "./gif";
import { createFetchQueue, type FetchQueue } from "./queue";

const CDN = "https://cdn.discordapp.com";
const SNOWFLAKE = /^\d+$/;
const HASH = /^[A-Za-z0-9_]+$/;

/** Celdas que ocupa un avatar: 2×1 ≈ un cuadrado (una celda mide ~1:2). */
export const AVATAR_COLS = 2;
/** Píxeles a los que se decodifica (lo mismo que se le pide al CDN). */
export const AVATAR_PX = 32;

export interface AvatarUser {
  id: string;
  avatar: string | null;
  /** Solo cuentas con el sistema viejo de nombres (bots, sobre todo): "0" o ausente = sistema nuevo. */
  discriminator?: string;
}

/** Índice de `embed/avatars/{n}.png`: (id >> 22) % 6 con el sistema nuevo, discriminador % 5 con el viejo. */
export function defaultAvatarIndex(user: Pick<AvatarUser, "id" | "discriminator">): number {
  const disc = user.discriminator;
  if (disc !== undefined && disc !== "0" && /^\d+$/.test(disc)) return Number(disc) % 5;
  if (!SNOWFLAKE.test(user.id)) return 0;
  return Number((BigInt(user.id) >> 22n) % 6n);
}

/**
 * URL del avatar en el CDN (docs.discord.food, CDN → Image formatting). `a_…` = animado: `.gif` si se
 * animan las imágenes; si no, `.png` (primer cuadro). Con `member.avatar` va el avatar propio del server.
 */
export function avatarUrl(user: AvatarUser, size = AVATAR_PX, opts: { animate?: boolean; guildId?: string | null; memberAvatar?: string | null } = {}): string {
  const ext = (hash: string): string => (opts.animate && hash.startsWith("a_") ? "gif" : "png");
  const valid = SNOWFLAKE.test(user.id);
  const member = opts.memberAvatar;
  if (valid && member && HASH.test(member) && opts.guildId && SNOWFLAKE.test(opts.guildId)) {
    return `${CDN}/guilds/${opts.guildId}/users/${user.id}/avatars/${member}.${ext(member)}?size=${size}`;
  }
  if (valid && user.avatar && HASH.test(user.avatar)) {
    return `${CDN}/avatars/${user.id}/${user.avatar}.${ext(user.avatar)}?size=${size}`;
  }
  return `${CDN}/embed/avatars/${defaultAvatarIndex(user)}.png`;
}

/** El avatar de un usuario como lo vería Discord en ese server (el del miembro gana). */
export function userAvatarUrl(state: AppState, userId: string, guildId: string | null, animate: boolean): string {
  const user = state.users[userId];
  const member = guildId !== null ? state.members[guildId]?.[userId] : undefined;
  return avatarUrl(
    { id: userId, avatar: user?.avatar ?? null, discriminator: user?.discriminator },
    AVATAR_PX,
    { animate, guildId, memberAvatar: member?.avatar ?? null },
  );
}

const masks = new Map<number, Float32Array>();

/** Alfa de un círculo de `px` de diámetro con borde suavizado de un pixel. */
function circleMask(px: number): Float32Array {
  const hit = masks.get(px);
  if (hit) return hit;
  const mask = new Float32Array(px * px);
  const r = px / 2;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      mask[y * px + x] = Math.min(1, Math.max(0, r - d + 0.5));
    }
  }
  masks.set(px, mask);
  return mask;
}

/** Recorta en círculo, en el lugar (RGBA sin premultiplicar). */
export function roundFrame(rgba: Uint8Array, px: number): void {
  const mask = circleMask(px);
  for (let i = 0; i < mask.length; i++) {
    const a = 4 * i + 3;
    rgba[a] = Math.round(rgba[a]! * mask[i]!);
  }
}

/**
 * Avatar → cuadros RGBA de `px × px` recortados en círculo (uno solo si no es animado). Sin sharp o
 * con un archivo roto: null (se muestra la imagen tal cual llegó).
 */
export async function decodeAvatar(bytes: Uint8Array, px = AVATAR_PX): Promise<Animation | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const animated = mayAnimate(bytes);
    const meta = await sharp(bytes, { animated }).metadata();
    const pages = animated ? meta.pages ?? 1 : 1;
    const { data, info } = await sharp(bytes, { animated: pages > 1 })
      .resize(px, px, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pageHeight = info.pageHeight ?? info.height;
    const count = Math.max(1, Math.floor(info.height / pageHeight));
    if (info.channels !== 4 || info.width !== px || pageHeight !== px) return null;
    const frameBytes = px * px * 4;
    const raw = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const frames: Frame[] = [];
    for (let i = 0; i < count; i++) {
      frames.push({ rgba: raw.slice(i * frameBytes, (i + 1) * frameBytes), delayMs: normalizeDelay(meta.delay?.[i]) });
    }
    const kept = limitFrames(frames, frameBytes);
    for (const frame of kept) roundFrame(frame.rgba, px);
    return { width: px, height: px, frames: kept, bytes: kept.length * frameBytes };
  } catch {
    return null;
  }
}

export type AvatarImage = { kind: "frames"; animation: Animation } | { kind: "bytes"; bytes: Uint8Array };

export interface AvatarLoader {
  /** Lo que ya está en memoria, sin pedir nada: así una fila que se vuelve a montar no parpadea. */
  peek(url: string): AvatarImage | null;
  /** Baja (por la cola) y decodifica. `wanted()` false cuando le toca el turno = no se baja. */
  get(url: string, wanted?: () => boolean): Promise<AvatarImage | null>;
  readonly bytes: number;
}

/** Una URL que falló no se vuelve a pedir hasta pasado esto (las filas se re-montan seguido). */
const RETRY_MS = 60_000;

export function createAvatarLoader(deps: {
  fetchBytes(url: string): Promise<Uint8Array | null>;
  decode(bytes: Uint8Array): Promise<Animation | null>;
  queue?: FetchQueue;
  maxBytes?: number;
  now?(): number;
}): AvatarLoader {
  const queue = deps.queue ?? createFetchQueue(6);
  const maxBytes = deps.maxBytes ?? 8 * 1024 * 1024;
  const now = deps.now ?? (() => Date.now());
  const entries = new Map<string, AvatarImage>();
  const failed = new Map<string, number>();
  const pending = new Map<string, { job: Promise<AvatarImage | null>; wanted: Set<() => boolean> }>();
  let total = 0;
  const sizeOf = (image: AvatarImage): number => (image.kind === "frames" ? image.animation.bytes : image.bytes.byteLength);

  function remember(url: string, image: AvatarImage): void {
    if (sizeOf(image) > maxBytes) return;
    entries.set(url, image);
    total += sizeOf(image);
    for (const [key, value] of entries) {
      if (total <= maxBytes) break;
      entries.delete(key);
      total -= sizeOf(value);
    }
  }

  return {
    get bytes() {
      return total;
    },
    peek(url) {
      const hit = entries.get(url);
      if (!hit) return null;
      entries.delete(url);
      entries.set(url, hit);
      return hit;
    },
    get(url, wanted = () => true) {
      const hit = this.peek(url);
      if (hit) return Promise.resolve(hit);
      const failedAt = failed.get(url);
      if (failedAt !== undefined && now() - failedAt < RETRY_MS) return Promise.resolve(null);
      const inFlight = pending.get(url);
      if (inFlight) {
        inFlight.wanted.add(wanted);
        return inFlight.job;
      }
      const wants = new Set([wanted]);
      let skipped = true;
      const job = (async (): Promise<AvatarImage | null> => {
        try {
          const bytes = await queue.run(
            () => ((skipped = false), deps.fetchBytes(url)),
            () => [...wants].some((w) => w()),
          );
          if (!bytes) {
            if (!skipped) failed.set(url, now());
            return null;
          }
          const animation = await deps.decode(bytes).catch(() => null);
          const image: AvatarImage = animation ? { kind: "frames", animation } : { kind: "bytes", bytes };
          failed.delete(url);
          remember(url, image);
          return image;
        } finally {
          pending.delete(url);
        }
      })();
      pending.set(url, { job, wanted: wants });
      return job;
    },
  };
}

// Sin LRU de bytes crudos (maxBytes 0): lo que se guarda es lo decodificado, con su propio tope de 8 MB.
const avatarFetch = createImageCache({ fetch: ((input, init) => globalThis.fetch(input, init)) as typeof fetch, maxBytes: 0 });

export const avatarLoader = createAvatarLoader({ fetchBytes: (url) => avatarFetch.get(url), decode: (bytes) => decodeAvatar(bytes) });
