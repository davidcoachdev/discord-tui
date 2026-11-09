// Imagen para compartir el link de la landing (og:image, 1200×630) a partir de la captura del chat.
import sharp from "sharp";

await sharp("docs/img/chat.png")
  .resize({ width: 1200, height: 630, fit: "cover", position: "top" })
  .png()
  .toFile("docs/img/og.png");
console.log("docs/img/og.png");
