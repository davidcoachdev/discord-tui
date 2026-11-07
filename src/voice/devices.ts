import { spawnClean } from "../proc/spawn";

export interface AudioDevice {
  name: string;
  description: string;
}

export type DeviceSpawn = (cmd: string[]) => {
  stdout: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
};

export async function listAudioDevices(deps?: { spawn?: DeviceSpawn }): Promise<{
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}> {
  const spawn = deps?.spawn ?? ((cmd: string[]) => spawnClean(cmd, { stdout: "pipe" }));
  const proc = spawn(["pw-dump"]);
  const stream = proc.stdout as unknown as ReadableStream<Uint8Array> | null;
  const text = stream ? await new Response(stream).text() : "";
  await proc.exited;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { inputs: [], outputs: [] };
  }
  if (!Array.isArray(parsed)) return { inputs: [], outputs: [] };

  const inputs: AudioDevice[] = [];
  const outputs: AudioDevice[] = [];

  for (const entry of parsed) {
    if (entry?.type !== "PipeWire:Interface:Node") continue;
    const props = entry.info?.props;
    if (!props) continue;
    const name = props["node.name"];
    const description = props["node.description"] ?? name;
    if (typeof name !== "string") continue;
    const device = { name, description: typeof description === "string" ? description : name };
    if (props["media.class"] === "Audio/Source") inputs.push(device);
    else if (props["media.class"] === "Audio/Sink") outputs.push(device);
  }

  return { inputs, outputs };
}

export function resolveTarget(
  saved: string | null,
  devices: AudioDevice[],
): { target: string | null; warning: string | null } {
  if (saved === null) return { target: null, warning: null };
  if (devices.some((device) => device.name === saved)) return { target: saved, warning: null };
  return { target: null, warning: `no encontré ${saved}, uso el predeterminado` };
}
