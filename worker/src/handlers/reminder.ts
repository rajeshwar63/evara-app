import { Env, InboundMessage } from "../types";
import { upsertUser, insertReminder } from "../supabase";
import { parseReminder } from "../gemini";
import { sendTextReply } from "../whatsapp";

export async function handleReminder(env: Env, message: InboundMessage): Promise<void> {
  console.log(`[handleReminder] START from=${message.from} text="${message.text}"`);
  const user = await upsertUser(env, message.from);
  console.log(`[handleReminder] upsertUser done user_id=${user.id}`);
  const text = message.text?.trim() ?? "";

  console.log(`[handleReminder] Parsing reminder via Gemini`);
  const parsed = await parseReminder(env, text);
  console.log(`[handleReminder] Parsed: task="${parsed.task}" date=${parsed.date} time=${parsed.time}`);

  // Build the remind_at timestamp
  const remindAt = parsed.raw_datetime || `${parsed.date}T${parsed.time}:00`;
  console.log(`[handleReminder] remind_at=${remindAt}`);

  console.log(`[handleReminder] Inserting reminder`);
  await insertReminder(env, {
    user_id: user.id,
    task: parsed.task,
    remind_at: remindAt,
    status: "pending",
    original_text: text,
  });

  console.log(`[handleReminder] Reminder inserted, sending reply`);
  // Format a friendly confirmation
  const dateStr = formatReminderDate(parsed.date, parsed.time);
  await sendTextReply(
    env,
    message.from,
    `Got it! I'll remind you: "${parsed.task}" on ${dateStr} ⏰`,
  );
  console.log(`[handleReminder] DONE`);
}

function formatReminderDate(date: string, time: string): string {
  try {
    const dt = new Date(`${date}T${time}:00`);
    return dt.toLocaleString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return `${date} at ${time}`;
  }
}
