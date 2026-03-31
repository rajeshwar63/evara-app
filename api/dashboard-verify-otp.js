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

// ═══════════════════════════════════════════════════════════════
// CORS HEADERS
// ═══════════════════════════════════════════════════════════════
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

  const { token, otp } = req.body || {};
  if (!token || !otp) {
    return res.status(400).json({ error: "Missing token or OTP" });
  }

  // 1. Find the most recent unverified, non-expired OTP for this token
  const { data: otpRow, error: otpErr } = await db()
    .from("dashboard_otps")
    .select("*")
    .eq("dashboard_token", token)
    .eq("verified", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (otpErr || !otpRow) {
    return res.status(400).json({ error: "No valid OTP found. Please request a new one." });
  }

  // 2. Increment attempts
  const newAttempts = otpRow.attempts + 1;

  // 3. Check if too many attempts
  if (newAttempts > 3) {
    // Expire the OTP
    await db()
      .from("dashboard_otps")
      .update({ attempts: newAttempts, expires_at: new Date().toISOString() })
      .eq("id", otpRow.id);
    return res.status(429).json({ error: "Too many attempts. Please request a new OTP." });
  }

  // 4. Update attempts count
  await db()
    .from("dashboard_otps")
    .update({ attempts: newAttempts })
    .eq("id", otpRow.id);

  // 5. Check if OTP matches
  if (otpRow.otp_code !== otp) {
    return res.status(400).json({
      error: "Incorrect code. Please try again.",
      attempts_remaining: 3 - newAttempts,
    });
  }

  // 6. Mark OTP as verified
  await db()
    .from("dashboard_otps")
    .update({ verified: true })
    .eq("id", otpRow.id);

  // 7. Create session
  const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data: session, error: sessionErr } = await db()
    .from("dashboard_sessions")
    .insert({
      dashboard_token: token,
      phone_number: otpRow.phone_number,
      expires_at: sessionExpiresAt,
    })
    .select("session_token")
    .single();

  if (sessionErr || !session) {
    console.error("[verify-otp] session create error:", sessionErr);
    return res.status(500).json({ error: "Failed to create session. Please try again." });
  }

  return res.status(200).json({
    success: true,
    session_token: session.session_token,
  });
};
