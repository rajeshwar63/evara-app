const { createClient } = require("@supabase/supabase-js");

const GRAPH_API = "https://graph.facebook.com/v22.0";

let _supabase = null;
function db() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return _supabase;
}

module.exports = async function handler(req, res) {
  // Only allow GET (cron) and block unauthorized access
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  // Verify cron secret to prevent unauthorized triggers
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const now = new Date().toISOString();

    // Find all unsent reminders that are due
    const { data: reminders, error } = await db()
      .from("reminders")
      .select("id, user_id, message, remind_at")
      .eq("sent", false)
      .lte("remind_at", now)
      .limit(20);

    if (error) throw error;

    if (!reminders || reminders.length === 0) {
      return res.status(200).json({ sent: 0 });
    }

    console.log(`[cron] Found ${reminders.length} due reminders`);

    let sentCount = 0;

    for (const reminder of reminders) {
      try {
        // Get user's phone number
        const { data: user } = await db()
          .from("users")
          .select("phone_number")
          .eq("id", reminder.user_id)
          .single();

        if (!user?.phone_number) {
          console.error(`[cron] No phone for user ${reminder.user_id}`);
          continue;
        }

        // Send reminder via WhatsApp
        const msg = `⏰ *Reminder!*\n\n📋 ${reminder.message}\n\n_This reminder was set by you._`;
        await sendText(user.phone_number, msg);

        // Mark as sent
        await db()
          .from("reminders")
          .update({ sent: true, sent_at: new Date().toISOString() })
          .eq("id", reminder.id);

        sentCount++;
        console.log(`[cron] Sent reminder ${reminder.id} to ${user.phone_number}`);
      } catch (err) {
        console.error(`[cron] Failed reminder ${reminder.id}:`, err);
      }
    }

    return res.status(200).json({ sent: sentCount, total: reminders.length });
  } catch (err) {
    console.error("[cron] Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

async function sendText(to, body) {
  const url = `${GRAPH_API}/${process.env.META_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) {
    console.error(`[cron] sendText failed ${res.status}:`, await res.text());
  }
}
