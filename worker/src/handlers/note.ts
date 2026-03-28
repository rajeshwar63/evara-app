import { Env, InboundMessage } from "../types";
import { upsertUser, insertDocument } from "../supabase";
import { generateNoteTitle } from "../gemini";
import { sendTextReply } from "../whatsapp";

export async function handleNote(env: Env, message: InboundMessage): Promise<void> {
  const user = await upsertUser(env, message.from);
  const text = message.text?.trim() ?? "";

  // Generate a title using Gemini
  const title = await generateNoteTitle(env, text);

  // Store as a text note in documents table
  await insertDocument(env, {
    user_id: user.id,
    message_type: "text_note",
    category: "note",
    title,
    extracted_text: text,
    tags: [],
    original_message_id: message.messageId,
  });

  await sendTextReply(
    env,
    message.from,
    `Noted! Saved as: "${title}". Search anytime to find it.`,
  );
}
