import { Env, InboundMessage } from "../types";
import { upsertUser, insertDocument, updateStorageUsed } from "../supabase";
import { uploadFile } from "../r2";
import { ocrImage } from "../gemini";
import { sendTextReply, downloadWhatsAppMedia } from "../whatsapp";

export async function handleImage(env: Env, message: InboundMessage): Promise<void> {
  console.log(`[handleImage] START from=${message.from} mediaId=${message.mediaId}`);
  const user = await upsertUser(env, message.from);
  console.log(`[handleImage] upsertUser done user_id=${user.id}`);

  if (!message.mediaId) {
    console.log(`[handleImage] No mediaId, sending error reply`);
    await sendTextReply(env, message.from, "I couldn't access that image. Please try sending it again.");
    return;
  }

  // Download image from WhatsApp via Meta Cloud API
  console.log(`[handleImage] Downloading media mediaId=${message.mediaId}`);
  const { data: imageBytes, mimeType } = await downloadWhatsAppMedia(env, message.mediaId);
  console.log(`[handleImage] Downloaded ${imageBytes.byteLength} bytes mimeType=${mimeType}`);

  // Upload to R2
  console.log(`[handleImage] Uploading to R2`);
  const { key, size } = await uploadFile(env, user.id, imageBytes, mimeType, message.fileName);
  console.log(`[handleImage] R2 upload done key=${key} size=${size}`);

  // OCR + tagging via Gemini
  console.log(`[handleImage] Starting OCR via Gemini`);
  const ocr = await ocrImage(env, imageBytes, mimeType);
  console.log(`[handleImage] OCR done category=${ocr.category} title=${ocr.title}`);

  // Store metadata in Supabase
  console.log(`[handleImage] Inserting document`);
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
    wa_message_id: message.messageId,
  });

  console.log(`[handleImage] Document inserted, updating storage`);
  // Update user storage
  await updateStorageUsed(env, user.id, size);
  console.log(`[handleImage] Storage updated, sending reply`);

  // Reply with confirmation
  await sendTextReply(env, message.from, ocr.whatsapp_reply);
  console.log(`[handleImage] DONE`);
}
