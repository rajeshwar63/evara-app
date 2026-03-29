import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export const supabaseAdmin: SupabaseClient = (() => {
  if (!_client) {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_KEY!; // service_role key
    _client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _client;
})();

// ─── User management ──────────────────────────────────────────
export async function getOrCreateUser(
  phone: string,
  name?: string
): Promise<string> {
  // Try to find existing user
  const { data: existing } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("phone", phone)
    .single();

  if (existing) return existing.id;

  // Create new user
  const { data: newUser, error } = await supabaseAdmin
    .from("users")
    .insert({
      phone,
      name: name || null,
      plan: "free_trial",
      trial_start: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[supabase] Failed to create user:", error);
    throw error;
  }

  console.log(`[supabase] Created new user ${newUser.id} for phone ${phone}`);
  return newUser.id;
}

// ─── Store document metadata ──────────────────────────────────
export async function storeDocument(doc: {
  user_id: string;
  doc_type: string;
  file_key: string;
  file_url: string;
  mime_type: string;
  file_size: number;
  ocr_text: string;
  category?: string;
  title?: string;
  tags?: string[];
  source_message_id?: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("documents")
    .insert(doc)
    .select("id, doc_type, category, title")
    .single();

  if (error) {
    console.error("[supabase] Failed to store document:", error);
    throw error;
  }

  return data;
}

// ─── Store a text note ────────────────────────────────────────
export async function storeTextNote(
  userId: string,
  text: string,
  title?: string
) {
  const { data, error } = await supabaseAdmin
    .from("documents")
    .insert({
      user_id: userId,
      doc_type: "text_note",
      file_key: null,
      file_url: null,
      mime_type: "text/plain",
      file_size: Buffer.byteLength(text, "utf-8"),
      ocr_text: text,
      category: "note",
      title: title || text.substring(0, 50),
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

// ─── Store a reminder ─────────────────────────────────────────
export async function storeReminder(reminder: {
  user_id: string;
  title: string;
  remind_at: string;
  raw_text: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("reminders")
    .insert(reminder)
    .select("id, title, remind_at")
    .single();

  if (error) throw error;
  return data;
}

// ─── Search documents ─────────────────────────────────────────
export async function searchDocuments(userId: string, query: string) {
  // Full-text search on ocr_text using ilike (simple approach)
  // For production, switch to Supabase pg_trgm or ts_vector
  const words = query
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 5);

  if (words.length === 0) {
    return [];
  }

  // Build an OR filter: each word matched via ilike
  let queryBuilder = supabaseAdmin
    .from("documents")
    .select("id, doc_type, category, title, ocr_text, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);

  // Use ilike with OR for each word
  const orConditions = words.map((w) => `ocr_text.ilike.%${w}%`).join(",");
  queryBuilder = queryBuilder.or(orConditions);

  const { data, error } = await queryBuilder;

  if (error) {
    console.error("[supabase] Search failed:", error);
    return [];
  }

  // Log the search
  await supabaseAdmin.from("search_log").insert({
    user_id: userId,
    query,
    result_count: data?.length || 0,
  });

  return data || [];
}
