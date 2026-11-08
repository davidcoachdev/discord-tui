/**
 * Servidor de stream FALSO para Go Live (del spike de Go Live, antes scripts/spike-golive/shim-fake.ts): un WS TLS local que
 * contesta como el servidor de video de Discord (HELLO, READY con un stream de video, SELECT_PROTOCOL_ACK con
 * una SDP real de libdatachannel y DAVE v1). Más un gateway falso que anota lo que se le manda.
 * Sin Discord ni cuenta: todo en 127.0.0.1.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PeerConnection } from "@lng2004/node-datachannel";

export interface FakeStreamServer {
  endpoint: string;
  /** Conexiones WS que recibió (debe ser 1 por stream). */
  connections(): number;
  /** Ops que mandó el cliente (`bin<N>` para los binarios). */
  ops: Array<{ op: number; d?: any; binary?: number }>;
  /** Cierra el WS abierto con un código (para probar los cortes). */
  closeWith(code: number): void;
  stop(): void;
}

export function startFakeStreamServer(): FakeStreamServer {
  const dir = mkdtempSync(join(tmpdir(), "golive-tls-"));
  Bun.spawnSync(
    ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
    { stdout: "ignore", stderr: "ignore" },
  );
  const cert = readFileSync(join(dir, "c.pem"), "utf8");
  const key = readFileSync(join(dir, "k.pem"), "utf8");
  rmSync(dir, { recursive: true, force: true });

  let connections = 0;
  const ops: FakeStreamServer["ops"] = [];
  const peers: PeerConnection[] = [];
  let open: Bun.ServerWebSocket<unknown> | null = null;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { cert, key },
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no", { status: 400 })),
    websocket: {
      open(ws) {
        connections++;
        open = ws;
      },
      message(ws, raw) {
        if (typeof raw !== "string") {
          ops.push({ op: -1, binary: Buffer.from(raw as Uint8Array)[0] });
          return;
        }
        const { op, d } = JSON.parse(raw);
        ops.push({ op, d });
        if (op === 0) {
          ws.send(JSON.stringify({ op: 8, d: { heartbeat_interval: 13_750 } }));
          ws.send(
            JSON.stringify({
              op: 2,
              d: {
                ssrc: 1000,
                ip: "127.0.0.1",
                port: 50000,
                modes: ["aead_aes256_gcm_rtpsize"],
                streams: [{ type: "video", rid: "100", ssrc: 1001, rtx_ssrc: 1002, active: false, quality: 100 }],
              },
            }),
          );
        } else if (op === 1) {
          // SDP real de libdatachannel: el cliente solo saca c=, a=rtcp, ice-ufrag/pwd, fingerprint y candidate.
          const peer = new PeerConnection("srv", { iceServers: [], bindAddress: "127.0.0.1" });
          peers.push(peer); // referencia viva: Bun junta con el GC lo que no se referencia
          peer.onLocalDescription((sdp, type) => {
            if (type !== "answer") return;
            ws.send(JSON.stringify({ op: 4, d: { sdp: `${sdp}\na=rtcp:50000\n`, dave_protocol_version: 1, audio_codec: "opus", video_codec: "H264" } }));
          });
          peer.setRemoteDescription(d.sdp, "offer");
        }
      },
      close() {
        open = null;
      },
    },
  });

  return {
    endpoint: `127.0.0.1:${server.port}`,
    connections: () => connections,
    ops,
    closeWith(code) {
      open?.close(code, "test");
    },
    stop() {
      for (const peer of peers) {
        try {
          peer.close();
        } catch {
          // ya cerrado
        }
      }
      server.stop(true);
    },
  };
}

/** Gateway falso con la forma de src/gateway/connection.ts: anota los `send` y deja emitir dispatches. */
export function fakeGateway() {
  const sent: Array<{ op: number; d: any }> = [];
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const on = (ev: string, fn: (...args: any[]) => void) => {
    const set = listeners.get(ev) ?? new Set();
    set.add(fn);
    listeners.set(ev, set);
    return () => set.delete(fn);
  };
  const emit = (ev: string, ...args: unknown[]) => listeners.get(ev)?.forEach((fn) => fn(...args));
  return {
    sent,
    send: (op: number, d: unknown) => void sent.push({ op, d: d as any }),
    on: on as any,
    dispatch: (t: string, d: unknown) => emit("dispatch", t, d),
    status: (s: string) => emit("status", s),
    session: (kind: "identified" | "resumed") => emit("session", kind),
    listenerCount: (ev: string) => listeners.get(ev)?.size ?? 0,
  };
}
