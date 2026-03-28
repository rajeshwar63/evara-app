import { Env, AiSensyReplyOptions } from "./types";

const AISENSY_API_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

/**
 * Send a text reply to a WhatsApp user via AiSensy.
 */
export async function sendTextReply(env: Env, destination: string, message: string): Promise<void> {
  await sendReply(env, {
    destination,
    message,
  });
}

/**
 * Send a media reply (image/document) with optional caption.
 */
export async function sendMediaReply(
  env: Env,
  destination: string,
  mediaUrl: string,
  filename: string,
  caption?: string,
): Promise<void> {
  await sendReply(env, {
    destination,
    message: caption,
    mediaUrl,
    mediaFilename: filename,
  });
}

async function sendReply(env: Env, options: AiSensyReplyOptions): Promise<void> {
  const body: Record<string, unknown> = {
    apiKey: env.AISENSY_API_KEY,
    campaignName: "evara_reply",
    destination: options.destination,
    userName: "Evara",
    templateParams: options.message ? [options.message] : [],
    source: "evara-worker",
    buttons: [],
  };

  if (options.mediaUrl) {
    body.media = {
      url: options.mediaUrl,
      filename: options.mediaFilename || "document",
    };
  }

  const res = await fetch(AISENSY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`AiSensy reply error ${res.status}: ${err}`);
  }
}
