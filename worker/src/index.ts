import { Env, MetaWebhookBody, InboundMessage } from "./types";
import { routeMessage } from "./router";
import { sendTextReply } from "./whatsapp";

export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ status: "ok", timestamp: new Date().toISOString() });
    }

    // Webhook verification (GET) — Meta sends this to verify the endpoint
    if (url.pathname === "/webhook" && request.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (mode === "subscribe" && token === env.WEBHOOK_VERIFY_TOKEN && challenge) {
        return new Response(challenge, { status: 200 });
      }

      return new Response("Forbidden", { status: 403 });
    }

    // Webhook handler (POST) — inbound WhatsApp messages from Meta
    if (url.pathname === "/webhook" && request.method === "POST") {
      let body: MetaWebhookBody;
      try {
        body = (await request.json()) as MetaWebhookBody;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }

      // Always return 200 immediately to Meta
      // Process messages asynchronously via waitUntil
      const messages = extractMessages(body);

      if (messages.length > 0) {
        ctx.waitUntil(processMessages(env, messages));
      }

      return jsonResponse({ status: "ok" });
    }

    // Serve R2 files (for search result delivery)
    if (url.pathname.startsWith("/files/") && request.method === "GET") {
      const key = url.pathname.replace("/files/", "");
      const obj = await env.EVARA_BUCKET.get(key);

      if (!obj) {
        return new Response("Not Found", { status: 404 });
      }

      const headers = new Headers();
      headers.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
      headers.set("Cache-Control", "public, max-age=3600");

      return new Response(obj.body, { headers });
    }

    return new Response("Not Found", { status: 404 });
  },
};

/**
 * Extract InboundMessage objects from the Meta webhook payload.
 */
function extractMessages(body: MetaWebhookBody): InboundMessage[] {
  const messages: InboundMessage[] = [];

  if (body.object !== "whatsapp_business_account") return messages;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value.messages) continue;

      for (const msg of value.messages) {
        const type = msg.type === "image" ? "image"
          : msg.type === "document" ? "document"
          : "text";

        messages.push({
          messageId: msg.id,
          from: msg.from,
          type: type as "text" | "image" | "document",
          text: msg.text?.body,
          mediaId: msg.image?.id ?? msg.document?.id,
          mimeType: msg.image?.mime_type ?? msg.document?.mime_type,
          fileName: msg.document?.filename,
          timestamp: msg.timestamp,
        });
      }
    }
  }

  return messages;
}

/**
 * Process extracted messages asynchronously.
 */
async function processMessages(env: Env, messages: InboundMessage[]): Promise<void> {
  for (const message of messages) {
    const startTime = Date.now();
    console.log(`[processMessages] START type=${message.type} from=${message.from} messageId=${message.messageId} text="${message.text ?? ""}" mediaId=${message.mediaId ?? "none"}`);
    try {
      await routeMessage(env, message);
      const elapsed = Date.now() - startTime;
      console.log(`[processMessages] SUCCESS type=${message.type} from=${message.from} in ${elapsed}ms`);
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.error(`[processMessages] FAILED type=${message.type} from=${message.from} after ${elapsed}ms:`, err);

      try {
        await sendTextReply(
          env,
          message.from,
          "Error: " + (err instanceof Error ? err.message : String(err)),
        );
      } catch (replyErr) {
        console.error("Failed to send error reply:", replyErr);
      }
    }
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
