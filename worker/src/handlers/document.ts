import { Env, InboundMessage } from "../types";
import { upsertUser, insertDocument, updateStorageUsed } from "../supabase";
import { uploadFile } from "../r2";
import { tagDocument } from "../gemini";
import { sendTextReply, downloadWhatsAppMedia } from "../whatsapp";

export async function handleDocument(env: Env, message: InboundMessage): Promise<void> {
  const user = await upsertUser(env, message.from);

  if (!message.mediaId) {
    await sendTextReply(env, message.from, "I couldn't access that file. Please try sending it again.");
    return;
  }

  // Download file from WhatsApp via Meta Cloud API
  const { data: fileBytes, mimeType } = await downloadWhatsAppMedia(env, message.mediaId);

  // Upload to R2
  const { key, size } = await uploadFile(env, user.id, fileBytes, mimeType, message.fileName);

  // Try to extract text for tagging
  // For PDFs and text files, we can attempt basic text extraction
  let extractedText = "";
  if (mimeType === "text/plain") {
    extractedText = new TextDecoder().decode(fileBytes);
  }

  // Tag via Gemini (even with minimal text, Gemini can work with filename/context)
  const textForTagging = extractedText || `File: ${message.fileName || "document"}, Type: ${mimeType}`;
  const tags = await tagDocument(env, textForTagging);

  // Store metadata
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
    original_message_id: message.messageId,
  });

  // Update storage
  await updateStorageUsed(env, user.id, size);

  // Reply
  await sendTextReply(env, message.from, tags.whatsapp_reply);
}
