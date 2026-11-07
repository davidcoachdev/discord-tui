export interface PresenceGateway {
  send(op: number, d: unknown): void;
}

export const DOCUMENTED_OP3 = { status: "online", since: 0, activities: [] as unknown[], afk: false };

export interface IdlePresence {
  activity(): void;
  stop(): void;
}

export function createIdlePresence(deps: {
  gateway: PresenceGateway;
  settings: () => { idleAfterMinutes: number | null };
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}): IdlePresence {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let isIdle = false;
  let stopped = false;

  function clearPending(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function scheduleIdle(): void {
    clearPending();
    const minutes = deps.settings().idleAfterMinutes;
    if (minutes === null) return;
    timer = setTimer(() => {
      timer = null;
      if (stopped || isIdle) return;
      isIdle = true;
      deps.gateway.send(3, { status: "idle", since: now(), activities: [], afk: false });
    }, minutes * 60_000);
  }

  return {
    activity(): void {
      if (stopped) return;
      if (isIdle) {
        isIdle = false;
        deps.gateway.send(3, { status: "online", since: 0, activities: [], afk: false });
      }
      scheduleIdle();
    },
    stop(): void {
      stopped = true;
      clearPending();
    },
  };
}
