import type { OwnStatus } from "../settings/settings";

export interface PresenceGateway {
  send(op: number, d: unknown): void;
}

export const DOCUMENTED_OP3 = { status: "online", since: 0, activities: [] as unknown[], afk: false };

export interface PresencePayload {
  status: OwnStatus;
  since: number;
  activities: unknown[];
  afk: boolean;
}

export interface IdlePresence {
  /** Hubo una tecla o click: vuelve de "ausente" automático y reprograma el timer. */
  activity(): void;
  /** El usuario eligió otro estado (ya guardado en settings): manda op 3 si se puede. */
  statusChanged(): void;
  /** La presencia que corresponde ahora (la que va en el identify). */
  current(): PresencePayload;
  /** Llegó READY (identify) o RESUMED: sincroniza lo que cambió mientras no había conexión. */
  sessionStarted(kind: "identified" | "resumed"): void;
  stop(): void;
}

/**
 * Presencia propia por op 3. El estado manual sale de `settings().status`; el "ausente"
 * automático por inactividad solo se aplica cuando el manual es "online" (no molestar e
 * invisible no se pisan nunca, ni por inactividad ni por actividad).
 */
export function createIdlePresence(deps: {
  gateway: PresenceGateway;
  settings: () => { idleAfterMinutes: number | null; status?: OwnStatus };
  /** Si el gateway está listo para recibir op 3 (antes del identify cerraría la conexión). */
  ready?: () => boolean;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}): IdlePresence {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const ready = deps.ready ?? (() => true);
  const manual = (): OwnStatus => deps.settings().status ?? "online";

  let timer: ReturnType<typeof setTimeout> | null = null;
  let autoIdleSince: number | null = null;
  let manualIdleSince: number | null = null;
  let lastSent: OwnStatus | null = null;
  let stopped = false;

  function clearPending(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function current(): PresencePayload {
    const status = manual();
    if (status === "online" && autoIdleSince !== null) {
      return { status: "idle", since: autoIdleSince, activities: [], afk: false };
    }
    if (status === "idle") {
      manualIdleSince ??= now();
      return { status, since: manualIdleSince, activities: [], afk: false };
    }
    manualIdleSince = null;
    return { status, since: 0, activities: [], afk: false };
  }

  function push(): void {
    if (stopped || !ready()) return;
    const payload = current();
    if (payload.status === lastSent) return;
    lastSent = payload.status;
    deps.gateway.send(3, payload);
  }

  function scheduleIdle(): void {
    clearPending();
    const minutes = deps.settings().idleAfterMinutes;
    if (minutes === null || manual() !== "online") return;
    timer = setTimer(() => {
      timer = null;
      if (stopped || autoIdleSince !== null || manual() !== "online") return;
      autoIdleSince = now();
      push();
    }, minutes * 60_000);
  }

  return {
    activity(): void {
      if (stopped) return;
      if (autoIdleSince !== null) {
        autoIdleSince = null;
        push();
      }
      scheduleIdle();
    },
    statusChanged(): void {
      if (stopped) return;
      autoIdleSince = null;
      push();
      scheduleIdle();
    },
    current,
    sessionStarted(kind): void {
      // El identify ya llevó `current()`; un resume conserva lo de la sesión anterior.
      if (kind === "identified") {
        lastSent = current().status;
        return;
      }
      push();
    },
    stop(): void {
      stopped = true;
      clearPending();
    },
  };
}
