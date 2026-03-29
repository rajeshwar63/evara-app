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
    // Log inbound — columns: wa_message_id, direction, message_type, content_preview, processed
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

📸 Send a *photo* or 📄 *PDF* — I'll scan, organize & save it
🔍 *Search* — just type what you're looking for
📝 *note:* your text — saves a quick note
⏰ *Remind me...* — sets a reminder
📂 *my docs* — manage & delete your files
📊 *plan* — check usage & upgrade

Try it — send me a document now!`;

  await sendText(from, welcome);
}

// ═══════════════════════════════════════════════════════════════
// MEDIA HANDLER
// ═══════════════════════════════════════════════════════════════
function mapCategory(cat) {
  const valid = ["identity", "medical", "financial", "education", "receipt", "legal", "insurance", "travel", "note", "other"];
  if (valid.includes(cat)) return cat;

  // Map old/wrong categories to valid ones
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
    if (mimeType === "application/pdf") {
      // For PDFs: only send first page worth of data (max 500KB) + filename
      const maxBytes = 500 * 1024;
      const trimmedBuffer = buffer.length > maxBytes ? buffer.slice(0, maxBytes) : buffer;
      const base64 = trimmedBuffer.toString("base64");
      const filename = media.filename || "document.pdf";
      ocrData = await ocrDocument(base64, mimeType, filename);
    } else {
      const base64 = buffer.toString("base64");
      ocrData = await ocrDocument(base64, mimeType);
    }
    const ocr = ocrData;

    // documents columns: user_id, wa_message_id, category, title, document_type,
    // extracted_text, amount, organization, language_detected, tags,
    // message_type, file_url, file_key, file_type, file_size_bytes
    const { error } = await db()
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
      });

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

    await sendText(from, reply);

    // Soft nudge at 80% for free users
    const { data: userData } = await db()
      .from("users")
      .select("plan, docs_this_month")
      .eq("id", userId)
      .single();

    if (userData) {
      const scanCount = (userData.docs_this_month || 0) + 1;
      await db().from("users").update({ docs_this_month: scanCount }).eq("id", userId);

      if (userData.plan === "free" && scanCount >= 12) {
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
// TEXT INPUT HANDLER
// ═══════════════════════════════════════════════════════════════
async function handleTextInput(from, text, messageId) {
  const userId = await getOrCreateUser(from);
  const lower = text.toLowerCase().trim();

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

  // "note:" or "save:" prefix → save as note
  if (lower.startsWith("note:") || lower.startsWith("save:")) {
    const noteText = text.replace(/^(note|save)\s*:\s*/i, "").trim();
    await handleNote(from, userId, noteText);
    return;
  }

  // Reminder keywords → classify with Gemini
  const reminderPattern = /\b(remind|reminder|yaad|alert|dilao|baje)\b/i;
  if (reminderPattern.test(lower)) {
    const intent = await classifyTextIntent(text);
    if (intent.intent === "reminder") {
      await handleReminder(from, userId, text, intent);
      return;
    }
  }

  // Everything else → search
  await handleSearch(from, userId, text);
}

async function handleReminder(from, userId, rawText, intent) {
  try {
    if (!intent.reminder_datetime) {
      await sendText(from, "⏰ I understood you want a reminder, but couldn't figure out the date/time. Try:\n\n_Remind me to pay rent on April 5 at 10am_\n_Kal subah 8 baje gym yaad dilao_");
      return;
    }

    // reminders columns: user_id, remind_at, reminder_type, message, original_text, sent
    const { data: reminder, error } = await db()
      .from("reminders")
      .insert({
        user_id: userId,
        remind_at: intent.reminder_datetime,
        reminder_type: "custom",
        message: intent.reminder_title || rawText.substring(0, 100),
        original_text: rawText,
        sent: false,
      })
      .select("id, message, remind_at")
      .single();

    if (error) throw error;

    const dt = new Date(reminder.remind_at);
    const dateStr = dt.toLocaleDateString("en-IN", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
    });
    const timeStr = dt.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    });

    await sendText(from, `⏰ *Reminder set!*\n\n📋 ${reminder.message}\n🗓️ ${dateStr}\n⏰ ${timeStr}\n\nI'll remind you when it's time!`);
  } catch (err) {
    console.error("[reminder] Failed:", err);
    await sendText(from, "😓 Failed to set the reminder. Please try again.");
  }
}

async function handleNote(from, userId, text, title) {
  try {
    const cleanText = text.replace(/^note\s*:\s*/i, "").trim();

    // Store as document with document_type = "text_note"
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

async function handleSearch(from, userId, query) {
  try {
    const words = query.split(/\s+/).filter((w) => w.length > 2).slice(0, 5);

    if (words.length === 0) {
      await sendText(from, "🔍 Please use longer keywords to search.");
      return;
    }

    // Search on extracted_text column
    const orConditions = words.map((w) => `extracted_text.ilike.%${w}%`).join(",");

    const { data: results, error } = await db()
      .from("documents")
      .select("id, document_type, category, title, extracted_text, created_at, file_key, file_type")
      .eq("user_id", userId)
      .or(orConditions)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) throw error;

    // search_log columns: user_id, query_text, results_count
    await db()
      .from("search_log")
      .insert({ user_id: userId, query_text: query, results_count: results?.length || 0 });

    if (!results || results.length === 0) {
      await sendText(from, `🔍 No documents found for *"${query}"*.\n\nTry different keywords, or send me a document to save it first!`);
      return;
    }

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

    // Send actual files back in chat (max 3 to avoid spam)
    const fileDocs = results.filter((d) => d.file_key).slice(0, 3);
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

  const plan = user.plan === "free" ? "Free Forever" : "Pro";
  const scansUsed = user.docs_this_month || 0;
  const scansLimit = user.plan === "free" ? 15 : "∞";
  const remindersUsed = user.reminders_this_month || 0;
  const remindersLimit = user.plan === "free" ? 30 : "∞";
  const storageMB = ((user.storage_used_bytes || 0) / (1024 * 1024)).toFixed(1);
  const storageLimitMB = user.plan === "free" ? 100 : 1024;

  let msg = `📊 *Your Evara Plan*\n\n`;
  msg += `📋 Plan: *${plan}*\n\n`;
  msg += `📸 Scans: ${scansUsed} / ${scansLimit} this month\n`;
  msg += `⏰ Reminders: ${remindersUsed} / ${remindersLimit} this month\n`;
  msg += `💾 Storage: ${storageMB} MB / ${storageLimitMB} MB\n`;

  if (user.plan === "free") {
    msg += `\n─────────────\n\n`;
    msg += `⬆️ *Upgrade to Pro — ₹299/year*\n\n`;
    msg += `✓ Unlimited scans\n`;
    msg += `✓ 1 GB storage\n`;
    msg += `✓ Unlimited reminders\n`;
    msg += `✓ Priority support\n\n`;
    msg += `📩 To upgrade, contact: wa.me/919398574255`;
  }

  await sendText(from, msg);
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
  // users table column is phone_number (not phone)
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
  "language": "primary language e.g. 'en', 'hi', 'te'"
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
    };
  } catch (e) {
    return { text: raw, category: "other", title: "Untitled Document", tags: [], amount: null, organization: null, language: null };
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
