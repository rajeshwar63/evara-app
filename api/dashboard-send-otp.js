const { createClient } = require("@supabase/supabase-js");

// ═══════════════════════════════════════════════════════════════
// LAZY CLIENT
// ═══════════════════════════════════════════════════════════════
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

const GRAPH_API = "https://graph.facebook.com/v22.0";

// ═══════════════════════════════════════════════════════════════
// CORS HEADERS
// ═══════════════════════════════════════════════════════════════
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ═══════════════════════════════════════════════════════════════
// SEND WHATSAPP TEXT
// ═══════════════════════════════════════════════════════════════
async function sendWhatsAppText(to, body) {
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
    const err = await res.text();
    throw new Error(`WhatsApp send failed: ${err}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ error: "Missing token" });
  }

  // 1. Look up dashboard token and get phone number via user
  const { data: tokenRow, error: tokenErr } = await db()
    .from("dashboard_tokens")
    .select("user_id, expires_at")
    .eq("token", token)
    .single();

  if (tokenErr || !tokenRow) {
    return res.status(400).json({ error: "Invalid or expired link" });
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return res.status(400).json({ error: "Invalid or expired link" });
  }

  // Get phone number from users table
  const { data: user, error: userErr } = await db()
    .from("users")
    .select("phone_number")
    .eq("id", tokenRow.user_id)
    .single();

  if (userErr || !user) {
    return res.status(400).json({ error: "Invalid or expired link" });
  }

  const phoneNumber = user.phone_number;

  // 2. Rate limit — check for OTP sent in last 60 seconds
  const { data: recentOtp } = await db()
    .from("dashboard_otps")
    .select("id")
    .eq("dashboard_token", token)
    .gte("created_at", new Date(Date.now() - 60 * 1000).toISOString())
    .limit(1);

  if (recentOtp && recentOtp.length > 0) {
    return res.status(429).json({ error: "OTP already sent. Please wait before requesting again." });
  }

  // 3. Generate 6-digit OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

  // 4. Insert OTP record
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { error: insertErr } = await db()
    .from("dashboard_otps")
    .insert({
      dashboard_token: token,
      phone_number: phoneNumber,
      otp_code: otpCode,
      expires_at: expiresAt,
      verified: false,
      attempts: 0,
    });

  if (insertErr) {
    console.error("[send-otp] insert error:", insertErr);
    return res.status(500).json({ error: "Failed to generate OTP. Please try again." });
  }

  // 5. Send OTP via WhatsApp
  const message =
    `\u{1F510} Your Evara verification code is: *${otpCode}*\n\n` +
    `Enter this code on the dashboard page to access your documents.\n\n` +
    `\u23F0 This code expires in 5 minutes.`;

  try {
    await sendWhatsAppText(phoneNumber, message);
  } catch (err) {
    console.error("[send-otp] WhatsApp send error:", err);
    // Clean up the OTP row on failure
    await db()
      .from("dashboard_otps")
      .delete()
      .eq("dashboard_token", token)
      .eq("otp_code", otpCode);
    return res.status(500).json({ error: "Failed to send OTP. Please try again." });
  }

  return res.status(200).json({ success: true, message: "OTP sent to your WhatsApp" });
};
