import { Env } from "./types";
import { parseInboundMessage } from "./utils";
import { routeMessage } from "./router";
import { sendTextReply } from "./aisensy";

export type { Env };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ status: "ok", timestamp: new Date().toISOString() });
    }

    // Webhook verification (GET) — some providers send a verification challenge
    if (url.pathname === "/webhook" && request.method === "GET") {
      const challenge = url.searchParams.get("hub.challenge");
      if (challenge) return new Response(challenge, { status: 200 });
      return jsonResponse({ status: "webhook active" });
    }

    // Webhook handler (POST) — inbound WhatsApp messages
    if (url.pathname === "/webhook" && request.method === "POST") {
      const startTime = Date.now();

      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }

      const message = parseInboundMessage(body);

      if (!message.from) {
        return jsonResponse({ error: "Missing sender" }, 400);
      }

      // Process asynchronously but respond immediately to avoid webhook timeout
      const ctx = { waitUntil: (p: Promise<unknown>) => p };
      // Use the execution context if available (Workers runtime provides it)
      // For now, we await inline since we need error handling
      try {
        await routeMessage(env, message);
        const elapsed = Date.now() - startTime;
        console.log(`Processed ${message.type} from ${message.from} in ${elapsed}ms`);
      } catch (err) {
        const elapsed = Date.now() - startTime;
        console.error(`Error processing message from ${message.from} after ${elapsed}ms:`, err);

        // Always reply to the user even on failure
        try {
          await sendTextReply(
            env,
            message.from,
            "Oops! Something went wrong processing your message. Please try again.",
          );
        } catch (replyErr) {
          console.error("Failed to send error reply:", replyErr);
        }
      }

      return jsonResponse({ status: "processed" });
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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
