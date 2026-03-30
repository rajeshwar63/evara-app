// ═══════════════════════════════════════════════════════════════
// EVARA: Supabase Edge Function — send-reminders
// ═══════════════════════════════════════════════════════════════
// Deploy with: supabase functions deploy send-reminders
// 
// This runs every 5 minutes via pg_cron + pg_net.
// It finds due reminders, sends WhatsApp messages, and updates status.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_API = "https://graph.facebook.com/v22.0";

Deno.serve(async (req) => {
  try {
    // Verify this is called by pg_cron or with valid auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    const metaToken = Deno.env.get("META_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("META_PHONE_NUMBER_ID");

    if (!metaToken || !phoneNumberId) {
      console.error("[send-reminders] Missing META env vars");
      return new Response(JSON.stringify({ error: "Missing config" }), { status: 500 });
    }

    // Get all due reminders using the database function
    const { data: reminders, error } = await supabase.rpc("get_due_reminders");

    if (error) {
      console.error("[send-reminders] DB error:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    if (!reminders || reminders.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No due reminders" }), { status: 200 });
    }

    console.log(`[send-reminders] Found ${reminders.length} due reminders`);

    let sentCount = 0;
    let failCount = 0;

    for (const reminder of reminders) {
      try {
        // Build the WhatsApp message
        const isFirstNotification = reminder.notification_count === 0;
        const buzzCount = reminder.notification_count + 1;

        let message = "";
        if (isFirstNotification) {
          message = `⏰ *Reminder!*\n\n`;
          message += `📋 ${reminder.message}\n\n`;
          message += `Reply:\n`;
          message += `✅ *done* — mark complete\n`;
          message += `⏰ *remind me in 2 hours* — snooze\n`;
          message += `🗓️ *remind me tomorrow* — postpone\n`;
          message += `❌ *cancel* — stop this reminder`;
        } else {
          message = `🔔 *Reminder (buzz #${buzzCount})*\n\n`;
          message += `📋 ${reminder.message}\n\n`;
          message += `⚡ _This reminder won't stop until you act on it!_\n\n`;
          message += `Reply *done* to complete, or *snooze* to delay.`;
        }

        // Send WhatsApp message
        const waRes = await fetch(
          `${GRAPH_API}/${phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${metaToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: reminder.phone_number,
              type: "text",
              text: { body: message },
            }),
          }
        );

        if (!waRes.ok) {
          const errText = await waRes.text();
          console.error(`[send-reminders] WhatsApp failed for ${reminder.id}:`, errText);
          failCount++;
          continue;
        }

        // Mark as notified using the database function
        const { error: updateErr } = await supabase.rpc("mark_reminder_notified", {
          reminder_id: reminder.id,
        });

        if (updateErr) {
          console.error(`[send-reminders] Update failed for ${reminder.id}:`, updateErr);
        }

        sentCount++;
        console.log(
          `[send-reminders] Sent to ${reminder.phone_number}: "${reminder.message}" (buzz #${buzzCount})`
        );
      } catch (err) {
        console.error(`[send-reminders] Error processing ${reminder.id}:`, err);
        failCount++;
      }
    }

    const result = {
      sent: sentCount,
      failed: failCount,
      total: reminders.length,
      timestamp: new Date().toISOString(),
    };

    console.log("[send-reminders] Complete:", result);
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    console.error("[send-reminders] Fatal error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
