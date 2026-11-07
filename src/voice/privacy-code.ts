/** Código de privacidad de DAVE en grupos de 5 dígitos (formato [nuestra] hasta confirmar el del cliente oficial). */
export function formatPrivacyCode(code: string): string {
  const digits = code.replace(/\s+/g, "");
  return digits.match(/.{1,5}/g)?.join(" ") ?? digits;
}
