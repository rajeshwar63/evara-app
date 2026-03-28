import { Env, InboundMessage } from "../types";
import { upsertUser, insertDocument } from "../supabase";
import { generateNoteTitle } from "../gemini";
import { sendTextReply } from "../whatsapp";

export async function handleNote(env: Env, message: InboundMessage): Promise<void> {
  console.log(`[handleNote] START from=${message.from} text="${message.text}"`);
  const user = await upsertUser(env, message.from);
  console.log(`[handleNote] upsertUser done user_id=${user.id}`);
  const text = message.text?.trim() ?? "";

  // Generate a title using Gemini
  console.log(`[handleNote] Generating title via Gemini`);
  const title = await generateNoteTitle(env, text);
  console.log(`[handleNote] Title generated: "${title}"`);

  // Store as a text note in documents table
  console.log(`[handleNote] Inserting document`);
  await insertDocument(env, {
    user_id: user.id,
    message_type: "text_note",
    category: "note",
    title,
    extracted_text: text,
    tags: [],
    wa_message_id: message.messageId,
  });

  console.log(`[handleNote] Document inserted, sending reply`);
  await sendTextReply(
    env,
    message.from,
    `Noted! Saved as: "${title}". Search anytime to find it.`,
  );
  console.log(`[handleNote] DONE`);
}
