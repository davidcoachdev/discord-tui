export type ImageMode = "kitty" | "blocks" | "links";

// Ghostty/Kitty soportan el protocolo gráfico (spec 6.1). Pendiente la
// confirmación visual de Gon: si muestra bloques, pasar a "blocks".
export const IMAGE_MODE: ImageMode = "kitty";
