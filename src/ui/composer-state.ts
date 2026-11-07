import type { PendingAttachment } from "../store/types";

export interface ComposerState {
  mode: "normal" | "insert";
  text: string;
  replyTo: string | null;
  editing: string | null;
  attachments: PendingAttachment[];
  mentions: { start: number; end: number; userId: string }[];
}

export function validateOutgoing(
  text: string,
  attachments: number,
): { ok: true } | { ok: false; reason: "empty" | "too_long" } {
  if (text.trim().length === 0 && attachments === 0) return { ok: false, reason: "empty" };
  if (text.length > 2000) return { ok: false, reason: "too_long" };
  return { ok: true };
}
