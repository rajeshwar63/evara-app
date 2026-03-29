import { sendTextMessage } from "../whatsapp";
import { classifyTextIntent } from "../gemini";
import {
  getOrCreateUser,
  storeTextNote,
  storeReminder,
  searchDocuments,
} from "../supabase";

export async function handleTextInput(
  from: string,
  text: string,
  messageId: string
): Promise<void> {
  const userId = await getOrCreateUser(from);

  // Classify intent via Gemini
  const intent = await classifyTextIntent(text);

  switch (intent.intent) {
    case "reminder":
      await handleReminder(from, userId, text, intent);
      break;

    case "note":
      await handleNote(from, userId, text, intent.note_title);
      break;

    case "search":
    default:
      await handleSearch(from, userId, text);
      break;
  }
}

// ─── Reminder ─────────────────────────────────────────────────
async function handleReminder(
  from: string,
  userId: string,
  rawText: string,
  intent: { reminder_title?: string; reminder_datetime?: string }
) {
  try {
    if (!intent.reminder_datetime) {
      await sendTextMessage(
        from,
        "⏰ I understood you want a reminder, but couldn't figure out the date/time. Try something like:\n\n_Remind me to pay rent on April 5 at 10am_\n_Kal subah 8 baje gym yaad dilao_"
      );
      return;
    }

    const reminder = await storeReminder({
      user_id: userId,
      title: intent.reminder_title || rawText.substring(0, 100),
      remind_at: intent.reminder_datetime,
      raw_text: rawText,
    });

    const dt = new Date(reminder.remind_at);
    const dateStr = dt.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const timeStr = dt.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    await sendTextMessage(
      from,
      `⏰ *Reminder set!*\n\n📋 ${reminder.title}\n🗓️ ${dateStr}\n⏰ ${timeStr}\n\nI'll remind you when it's time!`
    );
  } catch (err) {
    console.error("[text] Reminder creation failed:", err);
    await sendTextMessage(
      from,
      "😓 Failed to set the reminder. Please try again."
    );
  }
}

// ─── Note ─────────────────────────────────────────────────────
async function handleNote(
  from: string,
  userId: string,
  text: string,
  title?: string
) {
  try {
    // Strip "note:" prefix if present
    const cleanText = text.replace(/^note\s*:\s*/i, "").trim();

    const note = await storeTextNote(userId, cleanText, title);

    await sendTextMessage(
      from,
      `📝 *Note saved!*\n\n_${cleanText.substring(0, 150)}${cleanText.length > 150 ? "..." : ""}_\n\nYou can search for this later anytime.`
    );
  } catch (err) {
    console.error("[text] Note creation failed:", err);
    await sendTextMessage(
      from,
      "😓 Failed to save the note. Please try again."
    );
  }
}

// ─── Search ───────────────────────────────────────────────────
async function handleSearch(from: string, userId: string, query: string) {
  try {
    const results = await searchDocuments(userId, query);

    if (results.length === 0) {
      await sendTextMessage(
        from,
        `🔍 No documents found for *"${query}"*.\n\nTry different keywords, or send me a document to save it first!`
      );
      return;
    }

    let reply = `🔍 Found *${results.length}* result${results.length > 1 ? "s" : ""} for *"${query}"*:\n\n`;

    results.forEach((doc, i) => {
      const date = new Date(doc.created_at).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const icon = getDocIcon(doc.doc_type);
      const title = doc.title || "Untitled";
      const preview = doc.ocr_text
        ? doc.ocr_text.substring(0, 100).replace(/\n/g, " ")
        : "";

      reply += `${i + 1}. ${icon} *${title}*\n`;
      reply += `   📁 ${doc.category || doc.doc_type} · ${date}\n`;
      if (preview) {
        reply += `   _${preview}${doc.ocr_text?.length > 100 ? "..." : ""}_\n`;
      }
      reply += `\n`;
    });

    await sendTextMessage(from, reply.trim());
  } catch (err) {
    console.error("[text] Search failed:", err);
    await sendTextMessage(
      from,
      "😓 Search failed. Please try again with different keywords."
    );
  }
}

function getDocIcon(docType: string): string {
  switch (docType) {
    case "photo":
      return "📸";
    case "pdf":
      return "📄";
    case "text_note":
      return "📝";
    default:
      return "📎";
  }
}
