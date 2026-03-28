import { Env, InboundMessage } from "../types";
import { upsertUser, insertDocument, updateStorageUsed } from "../supabase";
import { uploadFile } from "../r2";
import { tagDocument } from "../gemini";
import { sendTextReply, downloadWhatsAppMedia } from "../whatsapp";

export async function handleDocument(env: Env, message: InboundMessage): Promise<void> {
  console.log(`[handleDocument] START from=${message.from} mediaId=${message.mediaId} fileName=${message.fileName}`);
  const user = await upsertUser(env, message.from);
  console.log(`[handleDocument] upsertUser done user_id=${user.id}`);

  if (!message.mediaId) {
    console.log(`[handleDocument] No mediaId, sending error reply`);
    await sendTextReply(env, message.from, "I couldn't access that file. Please try sending it again.");
    return;
  }

  // Download file from WhatsApp via Meta Cloud API
  console.log(`[handleDocument] Downloading media mediaId=${message.mediaId}`);
  const { data: fileBytes, mimeType } = await downloadWhatsAppMedia(env, message.mediaId);
  console.log(`[handleDocument] Downloaded ${fileBytes.byteLength} bytes mimeType=${mimeType}`);

  // Upload to R2
  console.log(`[handleDocument] Uploading to R2`);
  const { key, size } = await uploadFile(env, user.id, fileBytes, mimeType, message.fileName);
  console.log(`[handleDocument] R2 upload done key=${key} size=${size}`);

  // Try to extract text for tagging
  // For PDFs and text files, we can attempt basic text extraction
  let extractedText = "";
  if (mimeType === "text/plain") {
    extractedText = new TextDecoder().decode(fileBytes);
  }

  // Tag via Gemini (even with minimal text, Gemini can work with filename/context)
  const textForTagging = extractedText || `File: ${message.fileName || "document"}, Type: ${mimeType}`;
  console.log(`[handleDocument] Tagging via Gemini`);
  const tags = await tagDocument(env, textForTagging);
  console.log(`[handleDocument] Tags done category=${tags.category} title=${tags.title}`);

  // Store metadata
  console.log(`[handleDocument] Inserting document`);
  await insertDocument(env, {
    user_id: user.id,
    file_key: key,
    file_type: mimeType,
    file_size_bytes: size,
    message_type: "document",
    category: tags.category,
    title: tags.title,
    extracted_text: tags.extracted_text,
    tags: tags.tags,
    amount: tags.amount,
    date_detected: tags.date_detected,
    expiry_date: tags.expiry_date,
    organization: tags.organization,
    person_name: tags.person_name,
    document_type: tags.document_type,
    language_detected: tags.language_detected,
    confidence: tags.confidence,
    wa_message_id: message.messageId,
  });

  console.log(`[handleDocument] Document inserted, updating storage`);
  // Update storage
  await updateStorageUsed(env, user.id, size);
  console.log(`[handleDocument] Storage updated, sending reply`);

  // Reply
  await sendTextReply(env, message.from, tags.whatsapp_reply);
  console.log(`[handleDocument] DONE`);
}
