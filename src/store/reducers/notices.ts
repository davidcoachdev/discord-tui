import type { AppState, Notice } from "../types";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `notice-${counter}`;
}

export function applyNoticePush(
  state: AppState,
  key: string,
  level: Notice["level"],
  text: string,
  at: number,
): AppState {
  const existingEntry = Object.entries(state.notices).find(([, notice]) => notice.key === key);
  if (existingEntry) {
    const [id, notice] = existingEntry;
    return {
      ...state,
      notices: { ...state.notices, [id]: { ...notice, count: notice.count + 1, text, level, at } },
    };
  }
  const id = nextId();
  const notice: Notice = { id, key, level, text, count: 1, at };
  return { ...state, notices: { ...state.notices, [id]: notice } };
}

export function applyNoticeDismiss(state: AppState, id: string): AppState {
  if (!(id in state.notices)) return state;
  const notices = { ...state.notices };
  delete notices[id];
  return { ...state, notices };
}

const INFO_TTL_MS = 6000;

export function applyNoticeSweep(state: AppState, now: number): AppState {
  const notices = Object.fromEntries(
    Object.entries(state.notices).filter(([, notice]) => notice.level === "error" || now - notice.at < INFO_TTL_MS),
  );
  if (Object.keys(notices).length === Object.keys(state.notices).length) return state;
  return { ...state, notices };
}
