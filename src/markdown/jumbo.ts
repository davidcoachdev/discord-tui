import type { MdNode } from "./parse";

/** Discord agranda los emojis de un mensaje que es sólo emojis, hasta 27. */
export const JUMBO_MAX = 27;

export type JumboEmoji = { kind: "custom"; name: string; id: string; animated: boolean } | { kind: "unicode"; text: string };

const RGI_EMOJI = /^\p{RGI_Emoji}$/v;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Los emojis del mensaje si el contenido es sólo emojis (custom o unicode, ignorando espacios)
 * y son entre 1 y 27; si no, null.
 */
export function jumboEmoji(nodes: MdNode[]): JumboEmoji[] | null {
  const out: JumboEmoji[] = [];
  for (const node of nodes) {
    if (node.type === "emoji") out.push({ kind: "custom", name: node.name, id: node.id, animated: node.animated });
    else if (node.type === "text") {
      for (const { segment } of graphemes.segment(node.text)) {
        if (/^\s+$/.test(segment)) continue;
        if (!RGI_EMOJI.test(segment)) return null;
        out.push({ kind: "unicode", text: segment });
      }
    } else return null;
    if (out.length > JUMBO_MAX) return null;
  }
  return out.length > 0 ? out : null;
}
