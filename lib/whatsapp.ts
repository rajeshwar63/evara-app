const GRAPH_API = "https://graph.facebook.com/v22.0";

function getPhoneNumberId(): string {
  return process.env.META_PHONE_NUMBER_ID || "1126911513833857";
}

function getToken(): string {
  return process.env.META_ACCESS_TOKEN || "";
}

// ─── Send a text message ──────────────────────────────────────
export async function sendTextMessage(
  to: string,
  body: string
): Promise<void> {
  const url = `${GRAPH_API}/${getPhoneNumberId()}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[whatsapp] sendTextMessage failed: ${res.status}`, errBody);
    throw new Error(`WhatsApp send failed: ${res.status}`);
  }

  console.log(`[whatsapp] Sent text to ${to}: ${body.substring(0, 60)}...`);
}

// ─── Send a reaction emoji to a message ───────────────────────
export async function sendReactionMessage(
  to: string,
  messageId: string,
  emoji: string
): Promise<void> {
  const url = `${GRAPH_API}/${getPhoneNumberId()}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "reaction",
      reaction: { message_id: messageId, emoji },
    }),
  });

  if (!res.ok) {
    console.error(`[whatsapp] sendReaction failed: ${res.status}`);
  }
}

// ─── Download media from Meta servers ─────────────────────────
export async function downloadMedia(
  mediaId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  // Step 1: Get the media URL
  const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!metaRes.ok) {
    throw new Error(`Failed to get media URL: ${metaRes.status}`);
  }

  const metaJson = (await metaRes.json()) as {
    url: string;
    mime_type: string;
  };
  const mediaUrl = metaJson.url;
  const mimeType = metaJson.mime_type;

  console.log(`[whatsapp] Downloading media ${mediaId}: ${mimeType}`);

  // Step 2: Download the actual binary
  const downloadRes = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!downloadRes.ok) {
    throw new Error(`Failed to download media binary: ${downloadRes.status}`);
  }

  const arrayBuffer = await downloadRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log(`[whatsapp] Downloaded ${buffer.length} bytes`);
  return { buffer, mimeType };
}
