import { createSocket, type Socket } from "node:dgram";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decryptRtpsize, encryptRtpsize } from "../../src/voice/own/transport-crypto";

/**
 * Servidor de voz de Discord falso y local: WS TLS (v8) + UDP.
 * Habla lo justo del protocolo (spec 6.6): identify → hello/ready → IP discovery →
 * select protocol → session description (sin DAVE) → speaking → RTP rtpsize con AES-GCM.
 */
export interface FakeVoiceServer {
  endpoint: string;
  identify: any | null;
  selectProtocol: any | null;
  speaking: any[];
  /** Opus ya descifrado que mandó el cliente. */
  received: Uint8Array[];
  /** Manda audio de otro usuario hacia el cliente. */
  sendAudioFrom(userId: string, ssrc: number, opus: Uint8Array): void;
  close(code: number): void;
  stop(): void;
}

let tls: { cert: string; key: string } | null = null;

/** Cert self-signed para 127.0.0.1, generado una vez por corrida (no se commitea ninguna clave). */
function localTls(): { cert: string; key: string } {
  if (tls) return tls;
  const dir = mkdtempSync(join(tmpdir(), "discord-tui-tls-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  const proc = Bun.spawnSync(
    ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
    { stdout: "ignore", stderr: "ignore" },
  );
  if (proc.exitCode !== 0) throw new Error("hace falta openssl para el servidor de voz falso");
  tls = { cert: readFileSync(cert, "utf8"), key: readFileSync(key, "utf8") };
  return tls;
}

export async function startFakeVoiceServer(opts: { daveVersion?: number } = {}): Promise<FakeVoiceServer> {
  const secretKey = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
  const serverSsrc = 4242;
  let clientAddress: { address: string; port: number } | null = null;
  let ws: Bun.ServerWebSocket<unknown> | null = null;
  let outSeq = 0;
  let outTs = 0;
  let outNonce = 0;
  const announced = new Set<number>();

  const udp: Socket = createSocket("udp4");
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
  const udpPort = udp.address().port;

  const state: FakeVoiceServer = {
    endpoint: "",
    identify: null,
    selectProtocol: null,
    speaking: [],
    received: [],
    sendAudioFrom(userId, ssrc, opus) {
      if (!clientAddress || !ws) return;
      if (!announced.has(ssrc)) {
        announced.add(ssrc);
        ws.send(JSON.stringify({ op: 5, d: { user_id: userId, ssrc, speaking: 1 } }));
      }
      const header = new Uint8Array(12);
      const view = new DataView(header.buffer);
      header[0] = 0x80;
      header[1] = 0x78;
      view.setUint16(2, outSeq++ & 0xffff, false);
      view.setUint32(4, (outTs += 960) >>> 0, false);
      view.setUint32(8, ssrc, false);
      const packet = encryptRtpsize(header, opus, secretKey, outNonce++);
      udp.send(packet, clientAddress.port, clientAddress.address);
    },
    close(code) {
      ws?.close(code, "fake close");
    },
    stop() {
      try {
        ws?.close(1000);
      } catch {
        // ya cerrado
      }
      server.stop(true);
      udp.close();
    },
  };

  udp.on("message", (msg, rinfo) => {
    if (msg.length === 74 && msg.readUInt16BE(0) === 1) {
      clientAddress = { address: rinfo.address, port: rinfo.port };
      const reply = Buffer.alloc(74);
      reply.writeUInt16BE(2, 0);
      reply.writeUInt16BE(70, 2);
      reply.writeUInt32BE(msg.readUInt32BE(4), 4);
      reply.write(rinfo.address, 8, "utf8");
      reply.writeUInt16BE(rinfo.port, 72);
      udp.send(reply, rinfo.port, rinfo.address);
      return;
    }
    if (msg.length <= 12 || (msg[1]! & 0x7f) !== 0x78) return; // keepalive
    try {
      const opus = decryptRtpsize(new Uint8Array(msg), secretKey);
      if (opus) state.received.push(opus);
    } catch {
      // paquete que no se pudo descifrar
    }
  });

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: localTls(),
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined;
      return new Response("no", { status: 400 });
    },
    websocket: {
      open(socket) {
        ws = socket;
      },
      message(socket, raw) {
        if (typeof raw !== "string") return;
        const packet = JSON.parse(raw);
        switch (packet.op) {
          case 0:
            state.identify = packet.d;
            socket.send(JSON.stringify({ op: 8, d: { heartbeat_interval: 13_750 } }));
            socket.send(
              JSON.stringify({
                op: 2,
                d: { ssrc: serverSsrc, ip: "127.0.0.1", port: udpPort, modes: ["aead_aes256_gcm_rtpsize", "aead_xchacha20_poly1305_rtpsize"] },
              }),
            );
            return;
          case 1:
            state.selectProtocol = packet.d;
            socket.send(
              JSON.stringify({
                op: 4,
                d: { mode: packet.d.data.mode, secret_key: [...secretKey], dave_protocol_version: opts.daveVersion ?? 0 },
              }),
            );
            return;
          case 3:
            socket.send(JSON.stringify({ op: 6, d: { t: packet.d?.t ?? 0 } }));
            return;
          case 5:
            state.speaking.push(packet.d);
            return;
          default:
            return;
        }
      },
      close() {
        ws = null;
      },
    },
  });

  state.endpoint = `127.0.0.1:${server.port}`;
  return state;
}
