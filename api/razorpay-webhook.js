const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

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
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    // Verify Razorpay webhook signature
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (webhookSecret && signature) {
      const body = JSON.stringify(req.body);
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");

      if (signature !== expectedSignature) {
        console.error("[razorpay] Invalid webhook signature");
        return res.status(400).json({ error: "Invalid signature" });
      }
    }

    const event = req.body.event;
    const payload = req.body.payload;

    console.log(`[razorpay] Event: ${event}`);

    // Handle payment link paid event
    if (event === "payment_link.paid") {
      const paymentLink = payload.payment_link?.entity;
      const payment = payload.payment?.entity;

      if (!paymentLink || !payment) {
        console.error("[razorpay] Missing payload data");
        return res.status(200).json({ status: "ok" });
      }

      const referenceId = paymentLink.reference_id; // This is the user_id
      const amount = payment.amount / 100; // Convert from paise to rupees
      const paymentId = payment.id;
      const phone = payment.contact; // Payer's phone number

      console.log(`[razorpay] Payment received: ₹${amount}, ref=${referenceId}, payment=${paymentId}, phone=${phone}`);

      if (!referenceId) {
        console.error("[razorpay] No reference_id (user_id) in payment link");
        return res.status(200).json({ status: "ok" });
      }

      // Verify amount is ₹299
      if (amount < 299) {
        console.error(`[razorpay] Amount too low: ₹${amount}`);
        return res.status(200).json({ status: "ok" });
      }

      // Update user plan in Supabase
      const { data: user, error: userErr } = await db()
        .from("users")
        .update({
          plan: "individual",
        })
        .eq("id", referenceId)
        .select("id, phone_number")
        .single();

      if (userErr || !user) {
        console.error("[razorpay] Failed to update user:", userErr);
        return res.status(200).json({ status: "ok" });
      }

      console.log(`[razorpay] Upgraded user ${user.id} to individual plan`);

      // Send WhatsApp confirmation
      if (user.phone_number) {
        await sendText(
          user.phone_number,
          `🎉 *Welcome to Evara Pro!*\n\n` +
          `Your payment of ₹${amount} has been received.\n\n` +
          `You now have:\n` +
          `✓ Unlimited document scans\n` +
          `✓ 1 GB cloud storage\n` +
          `✓ Unlimited reminders\n` +
          `✓ Priority support\n\n` +
          `Payment ID: ${paymentId}\n\n` +
          `Your invoice is being generated... 🧾`
        );
      }

      // Generate and send invoice
      try {
        const invoiceRes = await fetch("https://evara-app.vercel.app/api/generate-invoice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: referenceId,
            payment_id: paymentId,
            amount: amount,
            phone_number: user.phone_number,
          }),
        });
        if (invoiceRes.ok) {
          console.log(`[razorpay] Invoice generated for user ${user.id}`);
        } else {
          console.error("[razorpay] Invoice generation failed:", await invoiceRes.text());
        }
      } catch (invoiceErr) {
        console.error("[razorpay] Invoice error:", invoiceErr);
      }

      return res.status(200).json({ status: "ok", upgraded: true });
    }

    // Handle other events gracefully
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[razorpay] Webhook error:", err);
    return res.status(200).json({ status: "ok" });
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
  if (!res.ok) console.error(`[razorpay] sendText failed ${res.status}:`, await res.text());
}
