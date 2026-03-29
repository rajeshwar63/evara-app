import { downloadMedia, sendTextMessage, sendReactionMessage } from "../whatsapp";
import { uploadToR2 } from "../r2";
import { ocrDocument } from "../gemini";
import { getOrCreateUser, storeDocument } from "../supabase";

interface MediaInfo {
  id: string;
  mime_type: string;
  caption?: string;
  filename?: string;
}

export async function handleMedia(
  from: string,
  media: MediaInfo,
  type: "image" | "document",
  messageId: string
): Promise<void> {
  const startTime = Date.now();

  try {
    // Step 1: Get or create user
    const userId = await getOrCreateUser(from);

    // Step 2: Download media from Meta
    const { buffer, mimeType } = await downloadMedia(media.id);

    // Step 3: Upload to R2
    const { key, url } = await uploadToR2(buffer, mimeType, from);

    // Step 4: OCR via Gemini
    const base64 = buffer.toString("base64");
    const ocr = await ocrDocument(base64, mimeType);

    // Step 5: Store metadata in Supabase
    const doc = await storeDocument({
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

    // Step 6: React with ✅ and send confirmation
    await sendReactionMessage(from, messageId, "✅");

    const sizeKB = Math.round(buffer.length / 1024);
    const tagStr =
      ocr.tags.length > 0 ? ocr.tags.map((t) => `#${t}`).join(" ") : "";

    let reply = `✅ *Document saved!*\n\n`;
    reply += `📋 *${ocr.title}*\n`;
    reply += `📁 Category: ${formatCategory(ocr.category)}\n`;
    reply += `📦 Size: ${sizeKB} KB\n`;

    if (ocr.text.length > 0) {
      const preview = ocr.text.substring(0, 200).replace(/\n/g, " ");
      reply += `\n📖 Preview:\n_${preview}${ocr.text.length > 200 ? "..." : ""}_\n`;
    }

    if (tagStr) {
      reply += `\n🏷️ ${tagStr}`;
    }

    reply += `\n\n⏱️ Processed in ${elapsed}s`;

    if (media.caption) {
      reply += `\n📎 Your note: _${media.caption}_`;
    }

    await sendTextMessage(from, reply);
  } catch (err) {
    console.error(`[media] Failed to process media for ${from}:`, err);
    await sendReactionMessage(from, messageId, "❌");
    await sendTextMessage(
      from,
      "❌ Sorry, I couldn't process that file. Please try again or send a different format."
    );
  }
}

function formatCategory(cat: string): string {
  const map: Record<string, string> = {
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
  return map[cat] || `📎 ${cat}`;
}
