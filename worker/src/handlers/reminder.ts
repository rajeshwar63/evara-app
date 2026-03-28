import { Env, InboundMessage } from "../types";
import { upsertUser, insertReminder } from "../supabase";
import { parseReminder } from "../gemini";
import { sendTextReply } from "../aisensy";

export async function handleReminder(env: Env, message: InboundMessage): Promise<void> {
  const user = await upsertUser(env, message.from);
  const text = message.text?.trim() ?? "";

  const parsed = await parseReminder(env, text);

  // Build the remind_at timestamp
  const remindAt = parsed.raw_datetime || `${parsed.date}T${parsed.time}:00`;

  await insertReminder(env, {
    user_id: user.id,
    task: parsed.task,
    remind_at: remindAt,
    status: "pending",
    original_text: text,
  });

  // Format a friendly confirmation
  const dateStr = formatReminderDate(parsed.date, parsed.time);
  await sendTextReply(
    env,
    message.from,
    `Got it! I'll remind you: "${parsed.task}" on ${dateStr} ⏰`,
  );
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
