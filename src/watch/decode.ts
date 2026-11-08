/**
 * Decodificador H264 → RGBA para ver transmisiones, con node-av (libavcodec dentro del proceso, la misma copia que
 * ya trae @dank074/discord-video-stream). Recibe access units Annex-B enteras (las arma `h264.ts` desde el RTP) y
 * devuelve cuadros RGBA achicados a la caja pedida. H264 no se puede saltear cuadros al decodificar (los P
 * dependen del anterior): se decodifican todos y solo se escalan los que se van a mostrar (`wantFrame`).
 */

export interface DecodedFrame {
  width: number;
  height: number;
  /** RGBA, `width * height * 4` bytes, sin padding. Se reusa: copiarlo si se guarda. */
  rgba: Uint8Array;
}

export interface H264Decoder {
  /**
   * Decodifica una access unit. Si `wantFrame` es false (o no sale cuadro), devuelve null sin escalar.
   * Asincrónico: libavcodec trabaja fuera del hilo de JS.
   */
  decode(au: Uint8Array, wantFrame: boolean): Promise<DecodedFrame | null>;
  /** Cambia la caja de salida (se aplica en el próximo cuadro). */
  resize(maxWidth: number, maxHeight: number): void;
  close(): void;
}

/** Tamaño de salida que entra en la caja sin agrandar y manteniendo el aspecto (lados pares). */
export function fitBox(srcW: number, srcH: number, maxW: number, maxH: number): { width: number; height: number } {
  const scale = Math.min(1, maxW / srcW, maxH / srcH);
  const even = (n: number) => Math.max(2, Math.floor((n * scale) / 2) * 2);
  return { width: even(srcW), height: even(srcH) };
}

export async function createH264Decoder(maxWidth: number, maxHeight: number): Promise<H264Decoder> {
  const av: any = await import("node-av");
  const c: any = await import("node-av/constants");
  // libav escribe a stderr ("non-existing PPS", "no frame!") y en la TUI eso ensucia la pantalla.
  av.Log.setLevel(c.AV_LOG_QUIET);
  const codec = av.Codec.findDecoder(c.AV_CODEC_ID_H264);
  if (!codec) throw new Error("sin decodificador H264");
  const ctx = new av.CodecContext();
  ctx.allocContext3(codec);
  // Hilos por slice (no por cuadro): sin la latencia extra de FF_THREAD_FRAME.
  ctx.threadCount = 2;
  ctx.threadType = c.FF_THREAD_SLICE;
  ctx.setFlags(c.AV_CODEC_FLAG_LOW_DELAY);
  const ret = await ctx.open2(codec, null);
  if (ret < 0) throw new Error(`no abre el decodificador H264 (${ret})`);

  const packet = new av.Packet();
  packet.alloc();
  const frame = new av.Frame();
  frame.alloc();
  let out: any = null;
  let scaler: any = null;
  let key = "";
  let box = { w: maxWidth, h: maxHeight };
  let rgba: Buffer | null = null;
  let closed = false;

  function ensureScaler(srcW: number, srcH: number, srcFmt: number): { width: number; height: number } {
    const size = fitBox(srcW, srcH, box.w, box.h);
    const k = `${srcW}x${srcH}:${srcFmt}>${size.width}x${size.height}`;
    if (k === key) return size;
    scaler?.freeContext();
    out?.free();
    scaler = new av.SoftwareScaleContext();
    scaler.getContext(srcW, srcH, srcFmt, size.width, size.height, c.AV_PIX_FMT_RGBA, c.SWS_FAST_BILINEAR);
    if (scaler.initContext() < 0) throw new Error("no se pudo escalar el video");
    out = new av.Frame();
    out.alloc();
    out.width = size.width;
    out.height = size.height;
    out.format = c.AV_PIX_FMT_RGBA;
    out.allocBuffer();
    rgba = Buffer.alloc(size.width * size.height * 4);
    key = k;
    return size;
  }

  return {
    async decode(au, wantFrame) {
      if (closed) return null;
      packet.data = Buffer.from(au.buffer, au.byteOffset, au.byteLength);
      const sent = await ctx.sendPacket(packet);
      packet.unref();
      if (sent < 0 && sent !== c.AVERROR_EAGAIN) return null; // datos rotos: se espera al próximo keyframe
      let shown: DecodedFrame | null = null;
      for (;;) {
        if (closed) return null;
        const got = await ctx.receiveFrame(frame);
        if (got < 0) break; // EAGAIN: no hay más cuadros por ahora
        if (wantFrame && !shown && frame.width > 0) {
          const size = ensureScaler(frame.width, frame.height, frame.format);
          await scaler.scaleFrame(out, frame);
          out.toBuffer(rgba); // copia empaquetada (sin el padding de línea)
          shown = { width: size.width, height: size.height, rgba: rgba! };
        }
        frame.unref();
      }
      return shown;
    },
    resize(w, h) {
      box = { w, h };
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        ctx.freeContext();
        scaler?.freeContext();
        packet.free();
        frame.free();
        out?.free();
      } catch {
        // ya liberado
      }
    },
  };
}
