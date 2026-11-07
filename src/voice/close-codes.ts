export function closeCodeMessage(code: number): string {
  switch (code) {
    case 4014:
      return "te desconectaron del canal";
    case 4017:
      return "Discord exige cifrado E2EE (DAVE) y no se pudo negociar";
    case 4006:
      return "la sesión de voz ya no es válida";
    case 4011:
      return "Discord no encontró un servidor de voz";
    case 4016:
      return "modo de cifrado no soportado";
    default:
      return `se cortó la voz (código ${code})`;
  }
}

/** Códigos con los que no tiene sentido volver a intentar solos. */
export function isFatalVoiceClose(code: number): boolean {
  return code === 4014 || code === 4017 || code === 4016 || code === 4004 || code === 4011;
}
