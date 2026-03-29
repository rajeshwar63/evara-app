import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleMessage } from "../lib/messageRouter";

// ─── GET: Meta Webhook Verification ───────────────────────────
function handleVerification(req: VercelRequest, res: VercelResponse) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("[webhook] Verification successful");
    return res.status(200).send(challenge);
  }

  console.warn("[webhook] Verification failed", { mode, token });
  return res.status(403).send("Forbidden");
}

// ─── POST: Incoming WhatsApp Messages ─────────────────────────
async function handleIncoming(req: VercelRequest, res: VercelResponse) {
  // Always return 200 immediately to Meta — process async
  res.status(200).json({ status: "ok" });

  try {
    const body = req.body;

    // Validate payload structure
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages?.length) {
      console.log("[webhook] No messages in payload (status update or other)");
      return;
    }

    const message = value.messages[0];
    const contact = value.contacts?.[0];
    const from = message.from; // sender's phone number (whatsapp id)
    const senderName = contact?.profile?.name || "User";

    console.log(
      `[webhook] Message from ${from} (${senderName}): type=${message.type}`
    );

    await handleMessage(message, from, senderName);
  } catch (err) {
    console.error("[webhook] Error processing message:", err);
  }
}

// ─── Entry Point ──────────────────────────────────────────────
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method === "GET") {
    return handleVerification(req, res);
  }

  if (req.method === "POST") {
    return handleIncoming(req, res);
  }

  return res.status(405).send("Method Not Allowed");
}
