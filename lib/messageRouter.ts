import { sendTextMessage, sendReactionMessage } from "./whatsapp";
import { handleGreeting } from "./handlers/greeting";
import { handleMedia } from "./handlers/media";
import { handleTextInput } from "./handlers/textInput";

export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  document?: {
    id: string;
    mime_type: string;
    filename?: string;
    caption?: string;
  };
  // other types we might add later
  [key: string]: any;
}

const GREETING_PATTERNS = /^(hi|hello|hey|help|start|menu|namaste|hola)$/i;

export async function handleMessage(
  message: WhatsAppMessage,
  from: string,
  senderName: string
) {
  const msgId = message.id;

  try {
    // Log the incoming message
    await logMessage(from, message);

    switch (message.type) {
      case "text": {
        const body = message.text?.body?.trim() || "";

        if (GREETING_PATTERNS.test(body)) {
          await handleGreeting(from, senderName);
          return;
        }

        // Route text to intent classifier
        await handleTextInput(from, body, msgId);
        return;
      }

      case "image": {
        // React with ⏳ to show we're processing
        await sendReactionMessage(from, msgId, "⏳");
        await handleMedia(from, message.image!, "image", msgId);
        return;
      }

      case "document": {
        const mime = message.document?.mime_type || "";
        const supportedDocs = [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp",
        ];

        if (!supportedDocs.includes(mime)) {
          await sendTextMessage(
            from,
            `⚠️ Sorry, I can't process *${mime}* files yet.\n\nI currently support:\n📸 Photos/Images\n📄 PDF documents\n📝 Text notes\n⏰ Reminders`
          );
          return;
        }

        await sendReactionMessage(from, msgId, "⏳");
        await handleMedia(from, message.document!, "document", msgId);
        return;
      }

      default:
        await sendTextMessage(
          from,
          `I received your ${message.type} message, but I can only process text, images, and PDFs right now. Send *hi* for help!`
        );
    }
  } catch (err) {
    console.error(`[router] Error handling message from ${from}:`, err);
    await sendTextMessage(
      from,
      "😓 Something went wrong while processing your message. Please try again."
    );
  }
}

// ─── Log message to Supabase ──────────────────────────────────
async function logMessage(from: string, message: WhatsAppMessage) {
  try {
    const { supabaseAdmin } = await import("./supabase");
    await supabaseAdmin.from("messages_log").insert({
      phone: from,
      direction: "inbound",
      message_type: message.type,
      message_id: message.id,
      payload: message,
    });
  } catch (err) {
    console.error("[router] Failed to log message:", err);
    // Non-critical, don't throw
  }
}
