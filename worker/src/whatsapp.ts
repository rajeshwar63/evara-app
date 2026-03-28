import { Env } from "./types";

const GRAPH_API_BASE = "https://graph.facebook.com/v22.0";

/**
 * Send a text reply to a WhatsApp user via Meta Cloud API.
 */
export async function sendTextReply(env: Env, to: string, message: string): Promise<void> {
  await callMessagesApi(env, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: message },
  });
}

/**
 * Send a media reply (image/document) with optional caption.
 */
export async function sendMediaReply(
  env: Env,
  to: string,
  mediaUrl: string,
  filename: string,
  caption?: string,
): Promise<void> {
  const isImage = /\.(jpg|jpeg|png|webp)$/i.test(filename);

  if (isImage) {
    await callMessagesApi(env, {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: mediaUrl, ...(caption ? { caption } : {}) },
    });
  } else {
    await callMessagesApi(env, {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { link: mediaUrl, filename, ...(caption ? { caption } : {}) },
    });
  }
}

/**
 * Download media from WhatsApp using a two-step process:
 * 1. GET /v22.0/{MEDIA_ID} to get the download URL
 * 2. GET that URL to get the binary data
 */
export async function downloadWhatsAppMedia(
  env: Env,
  mediaId: string,
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  // Step 1: Get media URL
  const metaRes = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
  });

  if (!metaRes.ok) {
    const err = await metaRes.text();
    throw new Error(`Failed to get media URL for ${mediaId}: ${metaRes.status} ${err}`);
  }

  const metaJson = (await metaRes.json()) as { url: string; mime_type?: string };

  // Step 2: Download the actual file
  const fileRes = await fetch(metaJson.url, {
    headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
  });

  if (!fileRes.ok) {
    const err = await fileRes.text();
    throw new Error(`Failed to download media ${mediaId}: ${fileRes.status} ${err}`);
  }

  const mimeType = metaJson.mime_type || fileRes.headers.get("content-type") || "application/octet-stream";
  const data = await fileRes.arrayBuffer();

  return { data, mimeType };
}

async function callMessagesApi(env: Env, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${GRAPH_API_BASE}/${env.META_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Meta WhatsApp API error ${res.status}: ${err}`);
  }
}
