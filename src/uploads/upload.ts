import type { RestClient } from "../rest/client";
import type { PendingAttachment } from "../store/types";

interface UploadSlot {
  id: string | number;
  upload_url: string;
  upload_filename: string;
}

export interface UploadedAttachment {
  id: string;
  filename: string;
  uploaded_filename: string;
}

function isBucketUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.endsWith(".googleapis.com");
}

export async function uploadAttachments(
  rest: RestClient,
  fetchFn: typeof fetch,
  channelId: string,
  files: PendingAttachment[],
): Promise<UploadedAttachment[]> {
  const response = await rest.request<{ attachments: UploadSlot[] }>("POST", `/channels/${channelId}/attachments`, {
    files: files.map((f, i) => ({ filename: f.filename, file_size: f.bytes.byteLength, id: String(i) })),
  });
  const slots = response.attachments;
  if (slots.length !== files.length || slots.some((slot) => !isBucketUrl(slot.upload_url))) {
    throw new Error("url de subida inesperada");
  }

  const out: UploadedAttachment[] = [];
  for (const [i, file] of files.entries()) {
    const slot = slots[i]!;
    const res = await fetchFn(slot.upload_url, {
      method: "PUT",
      body: file.bytes,
      headers: { "Content-Type": file.mime },
    });
    if (!res.ok) throw new Error(`la subida falló: ${res.status}`);
    out.push({ id: String(i), filename: file.filename, uploaded_filename: slot.upload_filename });
  }
  return out;
}
