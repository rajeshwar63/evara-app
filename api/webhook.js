const { createClient } = require("@supabase/supabase-js");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { randomUUID } = require("crypto");

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const GRAPH_API = "https://graph.facebook.com/v22.0";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const GREETING_PATTERNS = /^(hi|hello|hey|help|start|menu|namaste|hola)$/i;

const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const CATEGORY_ICONS = {
  identity: "🪪 Identity",
  medical: "🏥 Medical",
  financial: "💰 Financial",
  education: "🎓 Education",
  receipt: "🧾 Receipt",
  legal: "⚖️ Legal",
  insurance: "🛡️ Insurance",
  travel: "✈️ Travel",
  note: "📝 Note",
  other: "📎 Other",
};

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY SEARCH SESSION CACHE (per-user, auto-expires 10 min)
// ═══════════════════════════════════════════════════════════════
// Key: phone number, Value: { results: [...], query: "...", timestamp: Date.now() }
const searchSessions = new Map();
const SEARCH_SESSION_TTL = 10 * 60 * 1000; // 10 minutes

function setSearchSession(phone, query, results) {
  searchSessions.set(phone, {
    query,
    results,
    timestamp: Date.now(),
  });
}

function getSearchSession(phone) {
  const session = searchSessions.get(phone);
  if (!session) return null;
  // Expired?
  if (Date.now() - session.timestamp > SEARCH_SESSION_TTL) {
    searchSessions.delete(phone);
    return null;
  }
  return session;
}

function clearSearchSession(phone) {
  searchSessions.delete(phone);
}

// ═══════════════════════════════════════════════════════════════
// LAZY CLIENTS
// ═══════════════════════════════════════════════════════════════
let _supabase = null;
function db() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return _supabase;
}

let _s3 = null;
function r2() {
  if (!_s3) {
    _s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
      },
    });
  }
  return _s3;
}

// ═══════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      console.log("[webhook] Verification OK");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method === "POST") {
    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      if (!value?.messages?.length) {
        return res.status(200).json({ status: "ok" });
      }

      const message = value.messages[0];
      const from = message.from;
      const senderName = value.contacts?.[0]?.profile?.name || "User";

      console.log(`[webhook] ${from} (${senderName}): type=${message.type}`);
      await routeMessage(message, from, senderName);
    } catch (err) {
      console.error("[webhook] Error:", err);
    }
    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).send("Method Not Allowed");
};

// ═══════════════════════════════════════════════════════════════
// MESSAGE ROUTER
// ═══════════════════════════════════════════════════════════════
async function routeMessage(message, from, senderName) {
  try {
    await db()
      .from("messages_log")
      .insert({
        wa_message_id: message.id,
        direction: "inbound",
        message_type: message.type,
        content_preview: message.text?.body?.substring(0, 100) || message.type,
        processed: false,
      });

    switch (message.type) {
      case "text": {
        const body = message.text?.body?.trim() || "";
        if (GREETING_PATTERNS.test(body)) {
          await sendGreeting(from, senderName);
        } else {
          await handleTextInput(from, body, message.id);
        }
        break;
      }

      case "image": {
        await sendReaction(from, message.id, "⏳");
        await handleMedia(from, message.image, "image", message.id);
        break;
      }

      case "document": {
        const mime = message.document?.mime_type || "";
        const supported = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
        if (!supported.includes(mime)) {
          await sendText(from, `⚠️ Sorry, I can't process *${mime}* files yet.\n\nI support: 📸 Photos, 📄 PDFs, 📝 Text notes, ⏰ Reminders`);
          break;
        }
        await sendReaction(from, message.id, "⏳");
        await handleMedia(from, message.document, "document", message.id);
        break;
      }

      default:
        await sendText(from, `I received your ${message.type}, but I can only process text, images, and PDFs right now. Send *hi* for help!`);
    }
  } catch (err) {
    console.error(`[router] Error for ${from}:`, err);
    await sendText(from, "😓 Something went wrong. Please try again.");
  }
}

// ═══════════════════════════════════════════════════════════════
// GREETING
// ═══════════════════════════════════════════════════════════════
async function sendGreeting(from, senderName) {
  const name = senderName?.split(" ")[0] || "there";
  const welcome = `👋 Hi ${name}! I'm *Evara* — your document organizer on WhatsApp.

🔒 Your data is encrypted & only you can access it.

📸 Send a *photo* or 📄 *PDF* — I'll scan & save it
🔍 *Search* — type what you're looking for
📝 *note:* your text — saves a note
⏰ *Remind me...* — sets a reminder
📂 *my docs* — manage your files
📊 *plan* — check usage
⬆️ *upgrade* — go Pro for ₹299/year (all features!)
🔒 *privacy* — how your data is protected

Send me a document to get started!`;

  await sendText(from, welcome);
}

// ═══════════════════════════════════════════════════════════════
// MEDIA HANDLER
// ═══════════════════════════════════════════════════════════════
function mapCategory(cat) {
  const valid = ["identity", "medical", "financial", "education", "receipt", "legal", "insurance", "travel", "note", "other"];
  if (valid.includes(cat)) return cat;

  const map = {
    bill: "financial",
    invoice: "financial",
    bank_statement: "financial",
    tax: "financial",
    government_id: "identity",
    certificate: "education",
    warranty: "legal",
    ticket: "travel",
    letter: "other",
  };
  return map[cat] || "other";
}

async function handleMedia(from, media, type, messageId) {
  const startTime = Date.now();

  try {
    const userId = await getOrCreateUser(from);
    const { buffer, mimeType } = await downloadMedia(media.id);
    const { key, url } = await uploadToR2(buffer, mimeType, from);

    let ocrData;
    try {
      if (mimeType === "application/pdf") {
        const maxBytes = 500 * 1024;
        const trimmedBuffer = buffer.length > maxBytes ? buffer.slice(0, maxBytes) : buffer;
        const base64 = trimmedBuffer.toString("base64");
        const filename = media.filename || "document.pdf";
        ocrData = await ocrDocument(base64, mimeType, filename);
      } else {
        const base64 = buffer.toString("base64");
        ocrData = await ocrDocument(base64, mimeType);
      }
    } catch (ocrErr) {
      console.error("[media] OCR failed, saving with basic metadata:", ocrErr.message);
      ocrData = {
        text: "",
        category: "other",
        title: media.filename || "Untitled Document",
        tags: [],
        amount: null,
        organization: null,
        language: null,
        expiry_date: null,
        due_date: null,
      };
    }
    const ocr = ocrData;

    const { data: docRow, error } = await db()
      .from("documents")
      .insert({
        user_id: userId,
        wa_message_id: messageId,
        category: mapCategory(ocr.category),
        title: ocr.title,
        document_type: type === "image" ? "photo" : "pdf",
        extracted_text: ocr.text,
        amount: ocr.amount || null,
        organization: ocr.organization || null,
        language_detected: ocr.language || null,
        tags: ocr.tags,
        message_type: type === "document" ? "pdf" : type,
        file_url: url,
        file_key: key,
        file_type: mimeType,
        file_size_bytes: buffer.length,
      })
      .select("id")
      .single();

    if (error) throw error;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    await sendReaction(from, messageId, "✅");

    const sizeKB = Math.round(buffer.length / 1024);
    const tagStr = ocr.tags.length > 0 ? ocr.tags.map((t) => `#${t}`).join(" ") : "";

    let reply = `✅ *Document saved!*\n\n`;
    reply += `📋 *${ocr.title}*\n`;
    reply += `📁 Category: ${CATEGORY_ICONS[ocr.category] || "📎 " + ocr.category}\n`;
    reply += `📦 Size: ${sizeKB} KB\n`;

    if (ocr.text.length > 0) {
      const preview = ocr.text.substring(0, 200).replace(/\n/g, " ");
      reply += `\n📖 Preview:\n_${preview}${ocr.text.length > 200 ? "..." : ""}_\n`;
    }
    if (tagStr) reply += `\n🏷️ ${tagStr}`;
    reply += `\n\n⏱️ Processed in ${elapsed}s`;
    if (media.caption) reply += `\n📎 Your note: _${media.caption}_`;

    // ── AUTO-REMINDER from document dates (Smart plan feature preview) ──
    if (ocr.expiry_date || ocr.due_date) {
      const dateFound = ocr.expiry_date || ocr.due_date;
      const dateLabel = ocr.expiry_date ? "Expiry date" : "Due date";
      reply += `\n\n📅 *${dateLabel} detected:* ${dateFound}`;

      const { data: userData } = await db()
        .from("users")
        .select("plan")
        .eq("id", userId)
        .single();

      if (userData && (userData.plan === "individual" || userData.plan === "smart" || userData.plan === "family")) {
        try {
          const targetDate = new Date(dateFound);
          let reminderDate;
          if (ocr.expiry_date) {
            reminderDate = new Date(targetDate.getTime() - 7 * 24 * 60 * 60 * 1000);
          } else {
            reminderDate = new Date(targetDate);
            reminderDate.setHours(3, 30, 0, 0);
          }

          if (reminderDate > new Date()) {
            await db().from("reminders").insert({
              user_id: userId,
              remind_at: reminderDate.toISOString(),
              reminder_type: ocr.expiry_date ? "expiry" : "custom",
              message: `📄 ${ocr.title} — ${dateLabel}: ${dateFound}`,
              original_text: `Auto-reminder from document: ${ocr.title}`,
              sent: false,
              status: "pending",
              linked_document_id: docRow.id,
            });

            const reminderDateStr = reminderDate.toLocaleDateString("en-IN", {
              day: "numeric", month: "short", year: "numeric",
            });
            reply += `\n⏰ Auto-reminder set for *${reminderDateStr}*`;
          }
        } catch (autoErr) {
          console.error("[media] Auto-reminder failed:", autoErr.message);
        }
      } else {
        reply += `\n💡 _Upgrade to *Pro (₹299/yr)* for auto-reminders from documents!_`;
      }
    }

    await sendText(from, reply);

    // Soft nudge at 80% for free users
    const { data: userData2 } = await db()
      .from("users")
      .select("plan, docs_this_month")
      .eq("id", userId)
      .single();

    if (userData2) {
      const scanCount = (userData2.docs_this_month || 0) + 1;
      await db().from("users").update({ docs_this_month: scanCount }).eq("id", userId);

      if (userData2.plan === "free" && scanCount >= 12) {
        const remaining = 15 - scanCount;
        if (remaining > 0) {
          await sendText(from,
            `💡 You have *${remaining}* free scan${remaining === 1 ? '' : 's'} left this month.\n\n` +
            `Upgrade to *Pro* for ₹299/year — unlimited scans, 1GB storage.\n` +
            `Type *plan* to learn more.`
          );
        }
      }
    }
  } catch (err) {
    console.error(`[media] Failed for ${from}:`, err);
    await sendReaction(from, messageId, "❌");
    await sendText(from, "❌ Sorry, I couldn't process that file. Please try again.");
  }
}

// ═══════════════════════════════════════════════════════════════
// TEXT INPUT HANDLER  (updated with search pick + reminder reply)
// ═══════════════════════════════════════════════════════════════
async function handleTextInput(from, text, messageId) {
  const userId = await getOrCreateUser(from);
  const lower = text.toLowerCase().trim();

  // ── CHECK: Is this a number picking from search results? ──
  // Must be checked EARLY, before anything else interprets "1", "2", etc.
  const pickMatch = lower.match(/^(\d+)$/);
  if (pickMatch) {
    const pickNum = parseInt(pickMatch[1], 10);
    const session = getSearchSession(from);
    if (session && pickNum >= 1 && pickNum <= session.results.length) {
      await handleSearchPick(from, session, pickNum);
      return;
    }
    // No active session or out of range — fall through to normal flow
  }

  // ── CHECK: "all" to get all documents from search results ──
  if (lower === "all") {
    const session = getSearchSession(from);
    if (session) {
      await handleSearchPickAll(from, session);
      return;
    }
  }

  // "plan" / "upgrade" → show plan info
  const planPattern = /^(plan|upgrade|my plan|subscription|billing|usage|limit|status)$/i;
  if (planPattern.test(lower)) {
    await sendPlanInfo(from, userId);
    return;
  }

  // "my docs" / "dashboard" / "manage" → generate dashboard link
  const dashboardPattern = /^(my docs|my documents|dashboard|manage|manage docs|delete)$/i;
  if (dashboardPattern.test(lower)) {
    await sendDashboardLink(from, userId);
    return;
  }

  const privacyPattern = /^(privacy|security|data|how is my data|trust|safe|secure)$/i;
  if (privacyPattern.test(lower)) {
    await sendText(from,
      `🔒 *How Evara Protects Your Data*\n\n` +
      `📍 Your documents are stored on encrypted cloud servers — same infrastructure used by major companies.\n\n` +
      `👤 Only YOU can access your documents. No one else — not even us — can see your files.\n\n` +
      `🗑️ Delete anytime — type *my docs* to manage & delete.\n\n` +
      `🚫 We NEVER share, sell, or use your data for ads.\n\n` +
      `📋 *What we store:*\n` +
      `• The photo/PDF you send (encrypted)\n` +
      `• Extracted text (for search)\n` +
      `• Your phone number (to identify you)\n\n` +
      `📋 *What we DON'T do:*\n` +
      `• No sharing with third parties\n` +
      `• No training AI on your documents\n` +
      `• No access to your WhatsApp chats\n\n` +
      `🔗 Full policy: evara-app.com/privacy.html`
    );
    return;
  }

  // "my reminders" → show active reminders
  const remindersListPattern = /^(my reminders|reminders|active reminders|pending reminders)$/i;
  if (remindersListPattern.test(lower)) {
    await sendActiveReminders(from, userId);
    return;
  }

  // "note:" or "save:" prefix → save as note
  if (lower.startsWith("note:") || lower.startsWith("save:")) {
    const noteText = text.replace(/^(note|save)\s*:\s*/i, "").trim();
    await handleNote(from, userId, noteText);
    return;
  }

  // ── CHECK: Is this a reply to an active reminder? ──
  const reminderReplyPattern = /\b(done|completed|finish|ho gaya|kar diya|kar liya|hogaya|complete|cancel|stop|band|snooze|later|not now|baad me|kal|remind me)\b/i;
  if (reminderReplyPattern.test(lower)) {
    const { data: activeReminders } = await db()
      .from("reminders")
      .select("id, message, status, notification_count")
      .eq("user_id", userId)
      .in("status", ["active", "snoozed"])
      .order("last_notified_at", { ascending: false })
      .limit(5);

    if (activeReminders && activeReminders.length > 0) {
      const handled = await handleReminderReply(from, userId, text, activeReminders);
      if (handled) return;
    }
  }

  // Reminder keywords → classify with Gemini (for NEW reminders)
  const reminderPattern = /\b(remind|reminder|yaad|alert|dilao|baje)\b/i;
  if (reminderPattern.test(lower)) {
    const intent = await classifyTextIntent(text);
    if (intent.intent === "reminder") {
      await handleReminder(from, userId, text, intent);
      return;
    }
  }

  // Everything else → search
  // Clear any old search session when user does a NEW search
  clearSearchSession(from);
  await handleSearch(from, userId, text);
}

// ═══════════════════════════════════════════════════════════════
// SEARCH PICK HANDLER — user replied with a number
// ═══════════════════════════════════════════════════════════════
async function handleSearchPick(from, session, pickNum) {
  const doc = session.results[pickNum - 1];
  if (!doc) {
    await sendText(from, `⚠️ Invalid number. Please pick between 1 and ${session.results.length}.`);
    return;
  }

  const icon = doc.document_type === "photo" ? "📸"
    : doc.document_type === "pdf" ? "📄"
    : doc.document_type === "text_note" ? "📝" : "📎";

  // For text notes (no file), send the text content
  if (doc.document_type === "text_note" || !doc.file_key) {
    const preview = doc.extracted_text || "(no content)";
    await sendText(from,
      `${icon} *${doc.title || "Untitled"}*\n\n` +
      `${preview.substring(0, 1000)}${preview.length > 1000 ? "..." : ""}`
    );
    // Clear session after retrieval
    clearSearchSession(from);
    return;
  }

  // For files (images/PDFs), send the actual file
  try {
    const fileUrl = await getFileUrl(doc.file_key);
    if (fileUrl) {
      await sendMediaMessage(from, fileUrl, doc.file_type, doc.title || "Document");
    } else {
      await sendText(from, `❌ Could not retrieve the file. It may have been deleted.`);
    }
  } catch (err) {
    console.error("[searchPick] Failed to send file:", err);
    await sendText(from, `❌ Failed to retrieve the document. Please try again.`);
  }

  // Clear session after retrieval
  clearSearchSession(from);
}

// ═══════════════════════════════════════════════════════════════
// SEARCH PICK ALL — user replied "all"
// ═══════════════════════════════════════════════════════════════
async function handleSearchPickAll(from, session) {
  const fileDocs = session.results.filter((d) => d.file_key);
  const textDocs = session.results.filter((d) => !d.file_key);

  // Send text notes inline
  for (const doc of textDocs) {
    const preview = doc.extracted_text || "(no content)";
    await sendText(from,
      `📝 *${doc.title || "Untitled"}*\n\n` +
      `${preview.substring(0, 500)}${preview.length > 500 ? "..." : ""}`
    );
  }

  // Send files (max 5 to avoid flooding)
  const toSend = fileDocs.slice(0, 5);
  for (const doc of toSend) {
    try {
      const fileUrl = await getFileUrl(doc.file_key);
      if (fileUrl) {
        await sendMediaMessage(from, fileUrl, doc.file_type, doc.title || "Document");
      }
    } catch (err) {
      console.error("[searchPickAll] Failed to send file:", err);
    }
  }

  if (fileDocs.length > 5) {
    await sendText(from, `📎 Sent 5 of ${fileDocs.length} files. Use *my docs* to see all.`);
  }

  clearSearchSession(from);
}

// ═══════════════════════════════════════════════════════════════
// REMINDER REPLY HANDLER
// ═══════════════════════════════════════════════════════════════
async function handleReminderReply(from, userId, text, activeReminders) {
  try {
    const remindersList = activeReminders.map((r, i) =>
      `${i + 1}. [ID: ${r.id}] "${r.message}" (buzzed ${r.notification_count} times)`
    ).join("\n");

    const prompt = `You are a WhatsApp reminder assistant for Indian users.

The user has these ACTIVE reminders:
${remindersList}

User's reply: "${text}"

Classify the user's intent as ONE of:
1. "complete" — user says they finished the task (done, completed, ho gaya, kar diya, ✅, haan, yes, finished)
2. "snooze" — user wants to delay (snooze, later, not now, baad me, remind me in X, kal yaad dilao)
3. "cancel" — user wants to permanently stop this reminder (cancel, stop, delete, band karo, hatao)
4. "details" — user is asking what the reminder is about (kya tha, what, details, batao)
5. "not_reminder_reply" — the message is NOT about any active reminder

Respond in EXACT JSON (no markdown, no code fences):
{
  "action": "complete|snooze|cancel|details|not_reminder_reply",
  "reminder_id": "the UUID of the most relevant reminder, or null",
  "snooze_hours": number or null (how many hours to snooze, default 2),
  "snooze_until_datetime": "ISO 8601 if user specified exact time, or null"
}

Rules:
- If user says "done" without specifying which reminder, pick the most recently buzzed one
- "kal" = tomorrow 9 AM IST, "parso" = day after tomorrow 9 AM IST
- "2 ghante baad" = 2 hours, "1 hour" = 1 hour
- If the message doesn't seem related to any active reminder, return "not_reminder_reply"`;

    const raw = await callGemini([{ text: prompt }]);
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const result = JSON.parse(cleaned);

    if (result.action === "not_reminder_reply") {
      return false;
    }

    const reminderId = result.reminder_id;
    if (!reminderId) {
      return false;
    }

    switch (result.action) {
      case "complete": {
        await db().from("reminders").update({
          status: "completed",
          completed_at: new Date().toISOString(),
        }).eq("id", reminderId).eq("user_id", userId);

        const reminder = activeReminders.find(r => r.id === reminderId);
        await sendText(from,
          `✅ *Reminder completed!*\n\n` +
          `📋 ~~${reminder?.message || "Task"}~~\n\n` +
          `Great job! 💪`
        );
        return true;
      }

      case "snooze": {
        let snoozeUntil;
        if (result.snooze_until_datetime) {
          snoozeUntil = new Date(result.snooze_until_datetime);
        } else {
          const hours = result.snooze_hours || 2;
          snoozeUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
        }

        await db().from("reminders").update({
          status: "snoozed",
          snooze_until: snoozeUntil.toISOString(),
        }).eq("id", reminderId).eq("user_id", userId);

        const timeStr = snoozeUntil.toLocaleTimeString("en-IN", {
          hour: "2-digit", minute: "2-digit", hour12: true,
          timeZone: "Asia/Kolkata",
        });
        const dateStr = snoozeUntil.toLocaleDateString("en-IN", {
          day: "numeric", month: "short",
          timeZone: "Asia/Kolkata",
        });

        const reminder = activeReminders.find(r => r.id === reminderId);
        await sendText(from,
          `⏰ *Reminder snoozed!*\n\n` +
          `📋 ${reminder?.message || "Task"}\n` +
          `🔔 Next buzz: *${dateStr} at ${timeStr}*\n\n` +
          `_I'll keep reminding until you say "done"!_`
        );
        return true;
      }

      case "cancel": {
        await db().from("reminders").update({
          status: "cancelled",
        }).eq("id", reminderId).eq("user_id", userId);

        const reminder = activeReminders.find(r => r.id === reminderId);
        await sendText(from,
          `❌ *Reminder cancelled.*\n\n` +
          `📋 ~~${reminder?.message || "Task"}~~\n\n` +
          `This reminder won't buzz again.`
        );
        return true;
      }

      case "details": {
        const reminder = activeReminders.find(r => r.id === reminderId);
        if (reminder) {
          let msg = `📋 *Reminder Details*\n\n`;
          msg += `📝 ${reminder.message}\n`;
          msg += `🔔 Buzzed ${reminder.notification_count} time${reminder.notification_count !== 1 ? 's' : ''}\n\n`;
          msg += `Reply *done* to complete or *snooze* to delay.`;
          await sendText(from, msg);
        }
        return true;
      }

      default:
        return false;
    }
  } catch (err) {
    console.error("[reminderReply] Error:", err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// SHOW ACTIVE REMINDERS
// ═══════════════════════════════════════════════════════════════
async function sendActiveReminders(from, userId) {
  try {
    const { data: reminders, error } = await db()
      .from("reminders")
      .select("id, message, remind_at, status, notification_count")
      .eq("user_id", userId)
      .in("status", ["pending", "active", "snoozed"])
      .order("remind_at", { ascending: true })
      .limit(10);

    if (error) throw error;

    if (!reminders || reminders.length === 0) {
      await sendText(from, `📭 You have no active reminders.\n\nSet one by saying: _Remind me to pay rent on April 5_`);
      return;
    }

    let msg = `⏰ *Your Active Reminders*\n\n`;

    for (let i = 0; i < reminders.length; i++) {
      const r = reminders[i];
      const dt = new Date(r.remind_at);
      const dateStr = dt.toLocaleDateString("en-IN", {
        day: "numeric", month: "short",
        timeZone: "Asia/Kolkata",
      });
      const timeStr = dt.toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit", hour12: true,
        timeZone: "Asia/Kolkata",
      });

      const statusIcon = r.status === "active" ? "🔔"
        : r.status === "snoozed" ? "💤"
        : "⏳";

      msg += `${i + 1}. ${statusIcon} *${r.message}*\n`;
      msg += `   📅 ${dateStr} at ${timeStr}`;
      if (r.notification_count > 0) {
        msg += ` · buzzed ${r.notification_count}x`;
      }
      msg += `\n\n`;
    }

    msg += `Reply *done* to complete a task, or *cancel* to stop one.`;
    await sendText(from, msg);
  } catch (err) {
    console.error("[activeReminders] Error:", err);
    await sendText(from, "😓 Couldn't fetch your reminders. Please try again.");
  }
}

// ═══════════════════════════════════════════════════════════════
// REMINDER HANDLER
// ═══════════════════════════════════════════════════════════════
async function handleReminder(from, userId, rawText, intent) {
  try {
    if (!intent.reminder_datetime) {
      await sendText(from, "⏰ I understood you want a reminder, but couldn't figure out the date/time. Try:\n\n_Remind me to pay rent on April 5 at 10am_\n_Kal subah 8 baje gym yaad dilao_");
      return;
    }

    const { data: reminder, error } = await db()
      .from("reminders")
      .insert({
        user_id: userId,
        remind_at: intent.reminder_datetime,
        reminder_type: "custom",
        message: intent.reminder_title || rawText.substring(0, 100),
        original_text: rawText,
        sent: false,
        status: "pending",
      })
      .select("id, message, remind_at")
      .single();

    if (error) throw error;

    const dt = new Date(reminder.remind_at);
    const dateStr = dt.toLocaleDateString("en-IN", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
      timeZone: "Asia/Kolkata",
    });
    const timeStr = dt.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true,
      timeZone: "Asia/Kolkata",
    });

    await sendText(from,
      `⏰ *Reminder set!*\n\n` +
      `📋 ${reminder.message}\n` +
      `🗓️ ${dateStr}\n` +
      `⏰ ${timeStr}\n\n` +
      `🔔 _I'll keep buzzing every 2 hours until you reply "done"!_`
    );
  } catch (err) {
    console.error("[reminder] Failed:", err);
    await sendText(from, "😓 Failed to set the reminder. Please try again.");
  }
}

async function handleNote(from, userId, text, title) {
  try {
    const cleanText = text.replace(/^note\s*:\s*/i, "").trim();

    const { error } = await db()
      .from("documents")
      .insert({
        user_id: userId,
        category: "note",
        title: title || cleanText.substring(0, 50),
        document_type: "text_note",
        extracted_text: cleanText,
        message_type: "text_note",
        file_size_bytes: Buffer.byteLength(cleanText, "utf-8"),
      });

    if (error) throw error;

    await sendText(from, `📝 *Note saved!*\n\n_${cleanText.substring(0, 150)}${cleanText.length > 150 ? "..." : ""}_\n\nYou can search for this later anytime.`);
  } catch (err) {
    console.error("[note] Failed:", err);
    await sendText(from, "😓 Failed to save the note. Please try again.");
  }
}

// ═══════════════════════════════════════════════════════════════
// SEARCH HANDLER (updated: numbered list for >2 results)
// ═══════════════════════════════════════════════════════════════
async function handleSearch(from, userId, query) {
  try {
    const words = query.split(/\s+/).filter((w) => w.length > 2).slice(0, 5);

    if (words.length === 0) {
      await sendText(from, "🔍 Please use longer keywords to search.");
      return;
    }

    const orConditions = words.map((w) => `extracted_text.ilike.%${w}%`).join(",");

    const { data: results, error } = await db()
      .from("documents")
      .select("id, document_type, category, title, extracted_text, created_at, file_key, file_type")
      .eq("user_id", userId)
      .or(orConditions)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw error;

    await db()
      .from("search_log")
      .insert({ user_id: userId, query_text: query, results_count: results?.length || 0 });

    if (!results || results.length === 0) {
      await sendText(from, `🔍 No documents found for *"${query}"*.\n\nTry different keywords, or send me a document to save it first!`);
      return;
    }

    // ── 1 or 2 results: send directly (old behavior) ──
    if (results.length <= 2) {
      let reply = `🔍 Found *${results.length}* result${results.length > 1 ? "s" : ""} for *"${query}"*:\n\n`;

      for (let i = 0; i < results.length; i++) {
        const doc = results[i];
        const date = new Date(doc.created_at).toLocaleDateString("en-IN", {
          day: "numeric", month: "short", year: "numeric",
        });
        const icon = doc.document_type === "photo" ? "📸"
          : doc.document_type === "pdf" ? "📄"
          : doc.document_type === "text_note" ? "📝" : "📎";
        const title = doc.title || "Untitled";

        reply += `${i + 1}. ${icon} *${title}*\n`;
        reply += `   📁 ${doc.category || doc.document_type} · ${date}\n\n`;
      }

      await sendText(from, reply.trim());

      // Send files directly
      const fileDocs = results.filter((d) => d.file_key);
      for (const doc of fileDocs) {
        try {
          const fileUrl = await getFileUrl(doc.file_key);
          if (fileUrl) {
            await sendMediaMessage(from, fileUrl, doc.file_type, doc.title || "Document");
          }
        } catch (err) {
          console.error("[search] Failed to send file:", err);
        }
      }
      return;
    }

    // ── 3+ results: show numbered list, wait for pick ──
    let reply = `🔍 Found *${results.length}* results for *"${query}"*:\n\n`;

    for (let i = 0; i < results.length; i++) {
      const doc = results[i];
      const date = new Date(doc.created_at).toLocaleDateString("en-IN", {
        day: "numeric", month: "short", year: "numeric",
      });
      const icon = doc.document_type === "photo" ? "📸"
        : doc.document_type === "pdf" ? "📄"
        : doc.document_type === "text_note" ? "📝" : "📎";
      const title = doc.title || "Untitled";

      reply += `*${i + 1}.* ${icon} ${title}\n`;
      reply += `    📁 ${doc.category || doc.document_type} · ${date}\n\n`;
    }

    reply += `👆 *Reply with a number* to get that document.\n`;
    reply += `Or reply *all* to get everything.`;

    // Store session for this user
    setSearchSession(from, query, results);

    await sendText(from, reply.trim());
    return;
  } catch (err) {
    console.error("[search] Failed:", err);
    await sendText(from, "😓 Search failed. Please try again with different keywords.");
  }
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP API
// ═══════════════════════════════════════════════════════════════
async function getFileUrl(fileKey) {
  if (!fileKey) return null;
  const bucket = process.env.R2_BUCKET || "evara-documents";
  const command = new GetObjectCommand({ Bucket: bucket, Key: fileKey });
  return await getSignedUrl(r2(), command, { expiresIn: 3600 });
}

async function sendMediaMessage(to, mediaUrl, mimeType, caption) {
  const url = `${GRAPH_API}/${process.env.META_PHONE_NUMBER_ID}/messages`;
  const isImage = mimeType && mimeType.startsWith("image/");
  const type = isImage ? "image" : "document";

  const mediaObj = { link: mediaUrl };
  if (caption) mediaObj.caption = caption;
  if (!isImage) mediaObj.filename = caption || "document.pdf";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type,
      [type]: mediaObj,
    }),
  });
  if (!res.ok) console.error(`[wa] sendMedia failed ${res.status}:`, await res.text());
}

async function sendText(to, body) {
  const url = `${GRAPH_API}/${process.env.META_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "text", text: { body },
    }),
  });
  if (!res.ok) console.error(`[wa] sendText failed ${res.status}:`, await res.text());
}

async function sendDashboardLink(from, userId) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db().from("dashboard_tokens").insert({
    user_id: userId,
    token: token,
    expires_at: expiresAt,
  });

  const link = `https://evara-app.com/dashboard.html?token=${token}`;

  await sendText(from,
    `📂 *Your Document Dashboard*\n\n` +
    `Tap the link below to view, preview, and delete your documents:\n\n` +
    `🔗 ${link}\n\n` +
    `⏰ This link expires in 24 hours.\n` +
    `🔒 Only you can access it.`
  );
}

async function sendPlanInfo(from, userId) {
  const { data: user } = await db()
    .from("users")
    .select("plan, docs_this_month, reminders_this_month, storage_used_bytes")
    .eq("id", userId)
    .single();

  const isPaid = user.plan !== "free";
  const plan = isPaid ? "Pro (₹299/yr)" : "Free Forever";
  const scansUsed = user.docs_this_month || 0;
  const scansLimit = isPaid ? "∞" : 15;
  const remindersUsed = user.reminders_this_month || 0;
  const remindersLimit = isPaid ? "∞" : 30;
  const storageMB = ((user.storage_used_bytes || 0) / (1024 * 1024)).toFixed(1);
  const storageLimitMB = isPaid ? 2048 : 100;

  let msg = `📊 *Your Evara Plan*\n\n`;
  msg += `📋 Plan: *${plan}*\n\n`;
  msg += `📸 Scans: ${scansUsed} / ${scansLimit} this month\n`;
  msg += `⏰ Reminders: ${remindersUsed} / ${remindersLimit} this month\n`;
  msg += `💾 Storage: ${storageMB} MB / ${storageLimitMB} MB\n`;

  if (!isPaid) {
    msg += `\n─────────────\n\n`;
    msg += `⬆️ *Upgrade to Pro — ₹299/year*\n\n`;
    msg += `✓ Unlimited scans & storage (2 GB)\n`;
    msg += `✓ Unlimited reminders\n`;
    msg += `✓ Auto-reminders from documents\n`;
    msg += `✓ Expiry & due date alerts\n`;
    msg += `✓ Finance tracking & summaries\n`;
    msg += `✓ Smart nudges\n`;
    msg += `✓ Priority support\n\n`;
    msg += `That's just ₹25/month — less than a chai ☕\n`;

    const paymentLink = await createPaymentLink(userId, from);
    if (paymentLink) {
      msg += `\n💳 Pay securely: ${paymentLink}\n\n`;
      msg += `✅ Your plan upgrades automatically after payment.`;
    } else {
      msg += `\n💳 Pay securely: https://rzp.io/rzp/a1F4Ljhw\n\n`;
      msg += `After payment, send screenshot here and we'll activate Pro instantly.`;
    }
  } else {
    msg += `\n\n✅ You're on Pro! All features unlocked. Enjoy!`;
  }

  await sendText(from, msg);
}

async function createPaymentLink(userId, phone) {
  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) return null;

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const res = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: 29900,
        currency: "INR",
        description: "Evara Pro - 1 Year Plan",
        reference_id: userId,
        customer: {
          contact: `+${phone}`,
        },
        notify: {
          sms: false,
          email: false,
        },
        callback_url: "https://evara-app.com",
        callback_method: "get",
      }),
    });

    if (!res.ok) {
      console.error("[razorpay] Create link failed:", await res.text());
      return null;
    }

    const data = await res.json();
    console.log(`[razorpay] Created payment link: ${data.short_url} for user ${userId}`);
    return data.short_url;
  } catch (err) {
    console.error("[razorpay] Error creating payment link:", err);
    return null;
  }
}

async function sendReaction(to, messageId, emoji) {
  const url = `${GRAPH_API}/${process.env.META_PHONE_NUMBER_ID}/messages`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "reaction",
      reaction: { message_id: messageId, emoji },
    }),
  }).catch(() => {});
}

async function downloadMedia(mediaId) {
  const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
  });
  if (!metaRes.ok) throw new Error(`Media URL failed: ${metaRes.status}`);
  const meta = await metaRes.json();

  const dlRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
  });
  if (!dlRes.ok) throw new Error(`Media download failed: ${dlRes.status}`);

  const arrayBuffer = await dlRes.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType: meta.mime_type };
}

// ═══════════════════════════════════════════════════════════════
// R2 STORAGE
// ═══════════════════════════════════════════════════════════════
async function uploadToR2(buffer, mimeType, phone) {
  const ext = MIME_TO_EXT[mimeType] || "bin";
  const date = new Date().toISOString().slice(0, 10);
  const uuid = randomUUID().slice(0, 8);
  const key = `${phone}/${date}/${uuid}.${ext}`;
  const bucket = process.env.R2_BUCKET || "evara-documents";

  await r2().send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType,
  }));

  const url = `${process.env.R2_ENDPOINT}/${bucket}/${key}`;
  console.log(`[r2] Uploaded ${buffer.length} bytes → ${key}`);
  return { key, url };
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE HELPERS
// ═══════════════════════════════════════════════════════════════
async function getOrCreateUser(phone) {
  const { data: existing } = await db()
    .from("users")
    .select("id")
    .eq("phone_number", phone)
    .single();

  if (existing) return existing.id;

  const { data: newUser, error } = await db()
    .from("users")
    .insert({
      phone_number: phone,
      plan: "free",
      trial_ends_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  console.log(`[db] New user ${newUser.id} for ${phone}`);
  return newUser.id;
}

// ═══════════════════════════════════════════════════════════════
// GEMINI API
// ═══════════════════════════════════════════════════════════════
async function callGemini(parts) {
  const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    }),
  });

  if (!res.ok) {
    console.error(`[gemini] ${res.status}:`, await res.text());
    throw new Error(`Gemini failed: ${res.status}`);
  }

  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

async function ocrDocument(base64Data, mimeType, filename) {
  const prompt = `You are a document OCR and classification assistant for Indian users.
${filename ? `\nFilename: ${filename}` : ""}
NOTE: For PDFs, you may only see the first page. Extract what you can and classify based on that.

Extract ALL text from this document. Then classify it.

Respond in this EXACT JSON format (no markdown, no code fences):
{
  "text": "full extracted text here",
  "category": "one of: identity, medical, financial, education, receipt, legal, insurance, travel, note, other",
  "title": "short descriptive title like 'Electricity Bill - March 2026' or 'Aadhaar Card'",
  "tags": ["tag1", "tag2", "tag3"],
  "amount": "total amount if visible e.g. '1584' or null",
  "organization": "vendor/issuer name if visible or null",
  "language": "primary language e.g. 'en', 'hi', 'te'",
  "expiry_date": "ISO 8601 date if expiry/validity date found, e.g. '2026-12-31', or null",
  "due_date": "ISO 8601 date if payment due date found, e.g. '2026-04-15', or null"
}

Rules:
- Extract text in whatever language it appears (Hindi, Telugu, English, etc.)
- For bills/receipts, include amounts, dates, vendor names
- Title should be human-readable and specific
- Tags should include: document type, vendor/issuer if visible, month/year if visible
- If text is unreadable, set text to "" and category to "other"
- IMPORTANT: Look for expiry dates (valid until, expires on, validity, best before) and due dates (due by, pay before, last date, deadline)
- Return dates in ISO 8601 format (YYYY-MM-DD)`;

  const raw = await callGemini([
    { inlineData: { mimeType, data: base64Data } },
    { text: prompt },
  ]);

  try {
    const cleaned = raw.replace(/^[\s\S]*?{/, "{").replace(/}[\s\S]*$/, "}").trim();
    const parsed = JSON.parse(cleaned);
    return {
      text: parsed.text || "",
      category: parsed.category || "other",
      title: parsed.title || "Untitled Document",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      amount: parsed.amount || null,
      organization: parsed.organization || null,
      language: parsed.language || null,
      expiry_date: parsed.expiry_date || null,
      due_date: parsed.due_date || null,
    };
  } catch (e) {
    return { text: raw, category: "other", title: "Untitled Document", tags: [], amount: null, organization: null, language: null, expiry_date: null, due_date: null };
  }
}

async function classifyTextIntent(text) {
  const now = new Date().toISOString();

  const prompt = `You are a WhatsApp assistant for Indian users. Classify this message intent.

Current datetime: ${now}

User message: "${text}"

Classify as ONE of:
1. "reminder" — user wants to be reminded (contains: remind, yaad, alert, tomorrow, specific date/time)
2. "note" — user wants to save this as a note for future reference
3. "search" — user is searching for a previously saved document

Respond in EXACT JSON (no markdown, no code fences):

For reminder:
{"intent": "reminder", "reminder_title": "short title", "reminder_datetime": "ISO 8601 datetime"}

For note:
{"intent": "note", "note_title": "short title for the note"}

For search:
{"intent": "search"}

Rules:
- Parse Indian date formats: "kal" = tomorrow, "parso" = day after tomorrow
- Parse times: "subah 8 baje" = 08:00, "shaam 5 baje" = 17:00
- If unsure between note and search, pick "search"
- reminder_datetime must be valid ISO 8601
- Default time zone is IST (UTC+5:30)`;

  const raw = await callGemini([{ text: prompt }]);

  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return { intent: "search" };
  }
}
