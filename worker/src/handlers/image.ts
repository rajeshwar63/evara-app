import { Env, InboundMessage } from "../types";
import { upsertUser, insertDocument, updateStorageUsed } from "../supabase";
import { uploadFile } from "../r2";
import { ocrImage } from "../gemini";
import { sendTextReply } from "../aisensy";

export async function handleImage(env: Env, message: InboundMessage): Promise<void> {
  const user = await upsertUser(env, message.from);

  if (!message.mediaUrl) {
    await sendTextReply(env, message.from, "I couldn't access that image. Please try sending it again.");
    return;
  }

  // Download image from WhatsApp media URL
  const mediaRes = await fetch(message.mediaUrl);
  if (!mediaRes.ok) {
    await sendTextReply(env, message.from, "Failed to download your image. Please try again.");
    return;
  }

  const imageBytes = await mediaRes.arrayBuffer();
  const mimeType = message.mimeType || mediaRes.headers.get("content-type") || "image/jpeg";

  // Upload to R2
  const { key, size } = await uploadFile(env, user.id, imageBytes, mimeType, message.fileName);

  // OCR + tagging via Gemini
  const ocr = await ocrImage(env, imageBytes, mimeType);

  // Store metadata in Supabase
  await insertDocument(env, {
    user_id: user.id,
    file_key: key,
    file_type: mimeType,
    file_size_bytes: size,
    message_type: "image",
    category: ocr.category,
    title: ocr.title,
    extracted_text: ocr.extracted_text,
    tags: ocr.tags,
    amount: ocr.amount,
    date_detected: ocr.date_detected,
    expiry_date: ocr.expiry_date,
    organization: ocr.organization,
    person_name: ocr.person_name,
    document_type: ocr.document_type,
    language_detected: ocr.language_detected,
    confidence: ocr.confidence,
    original_message_id: message.messageId,
  });

  // Update user storage
  await updateStorageUsed(env, user.id, size);

  // Reply with confirmation
  await sendTextReply(env, message.from, ocr.whatsapp_reply);
}
