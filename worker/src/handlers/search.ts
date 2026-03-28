import { Env, InboundMessage } from "../types";
import { upsertUser, searchDocuments } from "../supabase";
import { getPublicUrl } from "../r2";
import { sendTextReply, sendMediaReply } from "../whatsapp";

export async function handleSearch(env: Env, message: InboundMessage): Promise<void> {
  const user = await upsertUser(env, message.from);
  const query = message.text?.trim() ?? "";

  const results = await searchDocuments(env, user.id, query);

  if (!results.length) {
    await sendTextReply(
      env,
      message.from,
      `No results found for "${query}". Try different keywords, or send me documents to store first!`,
    );
    return;
  }

  const top = results[0];

  // If it's a file-based document, send the file back
  if (top.file_key && top.message_type !== "text_note") {
    const fileUrl = getPublicUrl(env, top.file_key);
    const caption = formatSearchCaption(top);
    const filename = top.file_key.split("/").pop() || "document";

    await sendMediaReply(env, message.from, fileUrl, filename, caption);
  } else {
    // Text note — just send the content
    const reply = formatSearchCaption(top);
    await sendTextReply(env, message.from, reply);
  }

  // If there are more results, mention it
  if (results.length > 1) {
    await sendTextReply(
      env,
      message.from,
      `Found ${results.length} results. Showing the best match above. Be more specific to narrow down.`,
    );
  }
}

function formatSearchCaption(result: {
  title?: string;
  category?: string;
  extracted_text?: string;
  tags?: string[];
  created_at?: string;
}): string {
  const lines: string[] = [];

  if (result.title) lines.push(`*${result.title}*`);
  if (result.category) lines.push(`Category: ${result.category}`);
  if (result.extracted_text) {
    const preview = result.extracted_text.length > 200
      ? result.extracted_text.slice(0, 200) + "..."
      : result.extracted_text;
    lines.push(preview);
  }
  if (result.tags?.length) lines.push(`Tags: ${result.tags.join(", ")}`);

  return lines.join("\n") || "Document found.";
}
