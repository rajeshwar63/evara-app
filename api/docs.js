const { createClient } = require("@supabase/supabase-js");
const { S3Client, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// ═══════════════════════════════════════════════════════════════
// LAZY CLIENTS
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

let _s3 = null;
function r2() {
  if (!_s3) {
    _s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
      },
    });
  }
  return _s3;
}

const BUCKET = process.env.R2_BUCKET || "evara-documents";

// ═══════════════════════════════════════════════════════════════
// CORS HEADERS
// ═══════════════════════════════════════════════════════════════
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

// ═══════════════════════════════════════════════════════════════
// AUTH — verify dashboard token
// ═══════════════════════════════════════════════════════════════
async function authenticate(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);

  const { data, error } = await db()
    .from("dashboard_tokens")
    .select("user_id, expires_at")
    .eq("token", token)
    .single();

  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data.user_id;
}

// ═══════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const userId = await authenticate(req);
  if (!userId) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  if (req.method === "GET") {
    return handleList(userId, res);
  }

  if (req.method === "DELETE") {
    const docId = req.query.id;
    if (!docId) return res.status(400).json({ error: "Missing document id" });
    return handleDelete(userId, docId, res);
  }

  return res.status(405).json({ error: "Method not allowed" });
};

// ═══════════════════════════════════════════════════════════════
// GET — list documents
// ═══════════════════════════════════════════════════════════════
async function handleList(userId, res) {
  const { data: documents, error } = await db()
    .from("documents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[docs] list error:", error);
    return res.status(500).json({ error: "Failed to fetch documents" });
  }

  // Generate pre-signed URLs for documents with file_key
  const enriched = await Promise.all(
    documents.map(async (doc) => {
      if (doc.file_key) {
        try {
          const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: doc.file_key });
          doc.preview_url = await getSignedUrl(r2(), cmd, { expiresIn: 3600 });
        } catch (err) {
          console.error(`[docs] presign error for ${doc.file_key}:`, err);
          doc.preview_url = null;
        }
      }
      return doc;
    })
  );

  return res.status(200).json({ documents: enriched });
}

// ═══════════════════════════════════════════════════════════════
// DELETE — remove a document
// ═══════════════════════════════════════════════════════════════
async function handleDelete(userId, docId, res) {
  // Verify ownership
  const { data: doc, error: fetchErr } = await db()
    .from("documents")
    .select("id, file_key")
    .eq("id", docId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !doc) {
    return res.status(404).json({ error: "Document not found" });
  }

  // Delete from R2 if file exists
  if (doc.file_key) {
    try {
      await r2().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: doc.file_key }));
    } catch (err) {
      console.error(`[docs] R2 delete error for ${doc.file_key}:`, err);
    }
  }

  // Delete from database
  const { error: delErr } = await db()
    .from("documents")
    .delete()
    .eq("id", docId);

  if (delErr) {
    console.error("[docs] delete error:", delErr);
    return res.status(500).json({ error: "Failed to delete document" });
  }

  return res.status(200).json({ deleted: true });
}
