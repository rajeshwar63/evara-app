const { createClient } = require("@supabase/supabase-js");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
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
  bill: "📄 Bill",
  receipt: "🧾 Receipt",
  invoice: "🧾 Invoice",
  insurance: "🛡️ Insurance",
  medical: "🏥 Medical",
  government_id: "🪪 Government ID",
  certificate: "📜 Certificate",
  bank_statement: "🏦 Bank Statement",
  tax: "💰 Tax Document",
  warranty: "🔧 Warranty",
  ticket: "🎫 Ticket",
  letter: "✉️ Letter",
  other: "📎 Other",
};

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
  // GET: Meta webhook verification
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

  // POST: Incoming messages
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
        phone: from,
        direction: "inbound",
        message_type: message.type,
        message_id: message.id,
        payload: message,
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
        const supported = [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp",
        ];
        if (!supported.includes(mime)) {
          await sendText(
            from,
            `⚠️ Sorry, I can't process *${mime}* files yet.\n\nI support: 📸 Photos, 📄 PDFs, 📝 Text notes, ⏰ Reminders`
          );
          break;
        }
        await sendReaction(from, message.id, "⏳");
        await handleMedia(from, message.document, "document", message.id);
        break;
      }

      default:
        await sendText(
          from,
          `I received your ${message.type}, but I can only process text, images, and PDFs right now. Send *hi* for help!`
        );
    }
  } catch (err) {
    console.error(`[router] Error for ${from}:`, err);
    await sendText(from, "😓 Something went wrong. Please try again.");
  }
}

// ═══════════════════════════════════════════════════════════════
// GREETING HANDLER
// ═══════════════════════════════════════════════════════════════
async function sendGreeting(from, senderName) {
  const name = senderName?.split(" ")[0] || "there";
  const welcome = `👋 Hi ${name}! Welcome to *Evara* — your personal document organizer on WhatsApp.

Here's what I can do:

📸 *Send a photo* of any document (bill, receipt, Aadhaar, PAN, etc.) — I'll read it, organize it, and save it for you.

📄 *Send a PDF* — same magic, I'll extract all the text and file it.

📝 *Type a note* — I'll save it for you. Just write naturally, like "Note: Rent paid ₹15,000 for March".

⏰ *Set a reminder* — "Remind me to renew insurance on April 15" or "Kal subah 8 baje yaad dilao gym jaana hai".

🔍 *Search your docs* — "Find my electricity bill" or "Show Aadhaar" — I'll find it instantly.

Just send me something to get started! 🚀`;

  await sendText(from, welcome);
}

// ═══════════════════════════════════════════════════════════════
// MEDIA HANDLER (Image / PDF)
// ═══════════════════════════════════════════════════════════════
async function handleMedia(from, media, type, messageId) {
  const startTime = Date.now();

  try {
    const userId = await getOrCreateUser(from);
    const { buffer, mimeType } = await downloadMedia(media.id);
    const { key, url } = await uploadToR2(buffer, mimeType, from);

    const base64 = buffer.toString("base64");
    const ocr = await ocrDocument(base64, mimeType);

    await storeDocument({
      user_id: userId,
      doc_type: type === "image" ? "photo" : "pdf",
      file_key: key,
      file_url: url,
      mime_type: mimeType,
      file_size: buffer.length,
      ocr_text: ocr.text,
      category: ocr.category,
      title: ocr.title,
      tags: ocr.tags,
      source_message_id: messageId,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    await sendReaction(from, messageId, "✅");

    const sizeKB = Math.round(buffer.length / 1024);
    const tagStr =
      ocr.tags.length > 0 ? ocr.tags.map((t) => `#${t}`).join(" ") : "";

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

    if (media.caption) {
      reply += `\n📎 Your note: _${media.caption}_`;
    }

    await sendText(from, reply);
  } catch (err) {
    console.error(`[media] Failed for ${from}:`, err);
    await sendReaction(from, messageId, "❌");
    await sendText(
      from,
      "❌ Sorry, I couldn't process that file. Please try again."
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// TEXT INPUT HANDLER
// ═══════════════════════════════════════════════════════════════
async function handleTextInput(from, text, messageId) {
  const userId = await getOrCreateUser(from);
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

async function handleReminder(from, userId, rawText, intent) {
  try {
    if (!intent.reminder_datetime) {
      await sendText(
        from,
        "⏰ I understood you want a reminder, but couldn't figure out the date/time. Try:\n\n_Remind me to pay rent on April 5 at 10am_\n_Kal subah 8 baje gym yaad dilao_"
      );
      return;
    }

    const { data: reminder, error } = await db()
      .from("reminders")
      .insert({
        user_id: userId,
        title: intent.reminder_title || rawText.substring(0, 100),
        remind_at: intent.reminder_datetime,
        raw_text: rawText,
      })
      .select("id, title, remind_at")
      .single();

    if (error) throw error;

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

    await sendText(
      from,
      `⏰ *Reminder set!*\n\n📋 ${reminder.title}\n🗓️ ${dateStr}\n⏰ ${timeStr}\n\nI'll remind you when it's time!`
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
        doc_type: "text_note",
        mime_type: "text/plain",
        file_size: Buffer.byteLength(cleanText, "utf-8"),
        ocr_text: cleanText,
        category: "note",
        title: title || cleanText.substring(0, 50),
      });

    if (error) throw error;

    await sendText(
      from,
      `📝 *Note saved!*\n\n_${cleanText.substring(0, 150)}${cleanText.length > 150 ? "..." : ""}_\n\nYou can search for this later anytime.`
    );
  } catch (err) {
    console.error("[note] Failed:", err);
    await sendText(from, "😓 Failed to save the note. Please try again.");
  }
}

async function handleSearch(from, userId, query) {
  try {
    const words = query
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 5);

    if (words.length === 0) {
      await sendText(from, "🔍 Please use longer keywords to search.");
      return;
    }

    const orConditions = words.map((w) => `ocr_text.ilike.%${w}%`).join(",");

    const { data: results, error } = await db()
      .from("documents")
      .select("id, doc_type, category, title, ocr_text, created_at")
      .eq("user_id", userId)
      .or(orConditions)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) throw error;

    await db()
      .from("search_log")
      .insert({ user_id: userId, query, result_count: results?.length || 0 });

    if (!results || results.length === 0) {
      await sendText(
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
      const icon =
        doc.doc_type === "photo"
          ? "📸"
          : doc.doc_type === "pdf"
            ? "📄"
            : doc.doc_type === "text_note"
              ? "📝"
              : "📎";
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

    await sendText(from, reply.trim());
  } catch (err) {
    console.error("[search] Failed:", err);
    await sendText(
      from,
      "😓 Search failed. Please try again with different keywords."
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP API HELPERS
// ═══════════════════════════════════════════════════════════════
async function sendText(to, body) {
  const url = `${GRAPH_API}/${process.env.META_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
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
    console.error(`[wa] sendText failed ${res.status}:`, await res.text());
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
      messaging_product: "whatsapp",
      to,
      type: "reaction",
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

  await r2().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );

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
    .eq("phone", phone)
    .single();

  if (existing) return existing.id;

  const { data: newUser, error } = await db()
    .from("users")
    .insert({
      phone,
      plan: "free_trial",
      trial_start: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  console.log(`[db] New user ${newUser.id} for ${phone}`);
  return newUser.id;
}

async function storeDocument(doc) {
  const { data, error } = await db()
    .from("documents")
    .insert(doc)
    .select("id, doc_type, category, title")
    .single();

  if (error) throw error;
  return data;
}

// ═══════════════════════════════════════════════════════════════
// GEMINI API
// ═══════════════════════════════════════════════════════════════
async function callGemini(parts) {
  const res = await fetch(
    `${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    }
  );

  if (!res.ok) {
    console.error(`[gemini] ${res.status}:`, await res.text());
    throw new Error(`Gemini failed: ${res.status}`);
  }

  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

async function ocrDocument(base64Data, mimeType) {
  const prompt = `You are a document OCR and classification assistant for Indian users.

Extract ALL text from this document. Then classify it.

Respond in this EXACT JSON format (no markdown, no code fences):
{
  "text": "full extracted text here",
  "category": "one of: bill, receipt, invoice, insurance, medical, government_id, certificate, bank_statement, tax, warranty, ticket, letter, other",
  "title": "short descriptive title like 'Electricity Bill - March 2026' or 'Aadhaar Card'",
  "tags": ["tag1", "tag2", "tag3"]
}

Rules:
- Extract text in whatever language it appears (Hindi, Telugu, English, etc.)
- For bills/receipts, include amounts, dates, vendor names
- Title should be human-readable and specific
- Tags should include: document type, vendor/issuer if visible, month/year if visible
- If text is unreadable, set text to "" and category to "other"`;

  const raw = await callGemini([
    { inlineData: { mimeType, data: base64Data } },
    { text: prompt },
  ]);

  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      text: parsed.text || "",
      category: parsed.category || "other",
      title: parsed.title || "Untitled Document",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch (e) {
    return { text: raw, category: "other", title: "Untitled Document", tags: [] };
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
- reminder_datetime must be valid ISO 8601`;

  const raw = await callGemini([{ text: prompt }]);

  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return { intent: "search" };
  }
}
