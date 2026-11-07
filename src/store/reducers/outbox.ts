import type { AppState, OutboxItem } from "../types";

export function applyOutboxEnqueue(state: AppState, item: OutboxItem): AppState {
  return { ...state, outbox: { ...state.outbox, [item.nonce]: item } };
}

export function applyOutboxSent(state: AppState, nonce: string): AppState {
  if (!(nonce in state.outbox)) return state;
  const outbox = { ...state.outbox };
  delete outbox[nonce];
  return { ...state, outbox };
}

export function applyOutboxFailed(state: AppState, nonce: string, error: string): AppState {
  const item = state.outbox[nonce];
  if (!item) return state;
  return { ...state, outbox: { ...state.outbox, [nonce]: { ...item, state: "failed", error } } };
}

export function applyOutboxRetry(state: AppState, nonce: string): AppState {
  const item = state.outbox[nonce];
  if (!item) return state;
  return { ...state, outbox: { ...state.outbox, [nonce]: { ...item, state: "pending", error: null } } };
}
