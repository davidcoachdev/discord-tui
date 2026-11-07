/**
 * Los mensajes de debug de `@discordjs/voice` pueden traer el token de voz o el session_id.
 * Solo dejamos pasar cambios de estado, opcodes y códigos de cierre, sin payloads.
 */
export function sanitizeVoiceDebug(line: string): string | null {
  if (line.includes("{") || /token|session_id|secret/i.test(line)) return null;
  const compact = line.replace(/\s+/g, " ").trim();
  if (/state change/i.test(compact)) return compact.slice(0, 200);
  if (/\bop\s*\d+/i.test(compact)) return compact.slice(0, 120);
  if (/close code\s*\d+/i.test(compact) || /closed?\b.*\d{4}/i.test(compact)) return compact.slice(0, 120);
  return null;
}
