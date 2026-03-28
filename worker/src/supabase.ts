import { Env, User, Document, Reminder, SearchResult } from "./types";

function headers(env: Env, extra?: Record<string, string>): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: env.SUPABASE_KEY,
    Authorization: `Bearer ${env.SUPABASE_KEY}`,
    ...extra,
  };
}

function restUrl(env: Env, path: string): string {
  return `${env.SUPABASE_URL}/rest/v1/${path}`;
}

/**
 * Upsert a user by phone number. Returns the user record.
 */
export async function upsertUser(env: Env, phone: string): Promise<User> {
  console.log(`[upsertUser] START phone=${phone} url=${restUrl(env, "users")}`);
  const res = await fetch(restUrl(env, "users?on_conflict=phone_number"), {
    method: "POST",
    headers: headers(env, {
      Prefer: "return=representation,resolution=merge-duplicates",
    }),
    body: JSON.stringify({
      phone_number: phone,
      storage_used_bytes: 0,
    }),
  });

  console.log(`[upsertUser] Response status=${res.status}`);
  if (!res.ok) {
    const err = await res.text();
    console.error(`[upsertUser] FAILED status=${res.status} body=${err}`);
    throw new Error(`Supabase upsert user error ${res.status}: ${err}`);
  }

  const users = (await res.json()) as User[];
  console.log(`[upsertUser] SUCCESS user_id=${users[0]?.id} phone=${users[0]?.phone_number}`);
  return users[0];
}

/**
 * Insert a document record.
 */
export async function insertDocument(env: Env, doc: Document): Promise<Document> {
  console.log(`[insertDocument] START user_id=${doc.user_id} type=${doc.message_type} title=${doc.title}`);
  const res = await fetch(restUrl(env, "documents"), {
    method: "POST",
    headers: headers(env, { Prefer: "return=representation" }),
    body: JSON.stringify(doc),
  });

  console.log(`[insertDocument] Response status=${res.status}`);
  if (!res.ok) {
    const err = await res.text();
    console.error(`[insertDocument] FAILED status=${res.status} body=${err}`);
    throw new Error(`Supabase insert document error ${res.status}: ${err}`);
  }

  const docs = (await res.json()) as Document[];
  console.log(`[insertDocument] SUCCESS doc_id=${docs[0]?.id}`);
  return docs[0];
}

/**
 * Insert a reminder record.
 */
export async function insertReminder(env: Env, reminder: Reminder): Promise<Reminder> {
  console.log(`[insertReminder] START user_id=${reminder.user_id} task=${reminder.task} remind_at=${reminder.remind_at}`);
  const res = await fetch(restUrl(env, "reminders"), {
    method: "POST",
    headers: headers(env, { Prefer: "return=representation" }),
    body: JSON.stringify(reminder),
  });

  console.log(`[insertReminder] Response status=${res.status}`);
  if (!res.ok) {
    const err = await res.text();
    console.error(`[insertReminder] FAILED status=${res.status} body=${err}`);
    throw new Error(`Supabase insert reminder error ${res.status}: ${err}`);
  }

  const reminders = (await res.json()) as Reminder[];
  console.log(`[insertReminder] SUCCESS reminder_id=${reminders[0]?.id}`);
  return reminders[0];
}

/**
 * Search documents using the search_documents RPC function.
 */
export async function searchDocuments(env: Env, userId: string, query: string): Promise<SearchResult[]> {
  console.log(`[searchDocuments] START user_id=${userId} query="${query}"`);
  const res = await fetch(restUrl(env, "rpc/search_documents"), {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      p_user_id: userId,
      p_query: query,
    }),
  });

  console.log(`[searchDocuments] Response status=${res.status}`);
  if (!res.ok) {
    const err = await res.text();
    console.error(`[searchDocuments] FAILED status=${res.status} body=${err}`);
    throw new Error(`Supabase search error ${res.status}: ${err}`);
  }

  const results = (await res.json()) as SearchResult[];
  console.log(`[searchDocuments] SUCCESS count=${results.length}`);
  return results;
}

/**
 * Update a user's storage_used_bytes by adding the given delta.
 */
export async function updateStorageUsed(env: Env, userId: string, deltaBytes: number): Promise<void> {
  // Use RPC or PATCH — we'll use a simple PATCH with computed value
  // First get current value, then update
  const getRes = await fetch(
    restUrl(env, `users?id=eq.${userId}&select=storage_used_bytes`),
    { method: "GET", headers: headers(env) },
  );

  if (!getRes.ok) return;
  const users = (await getRes.json()) as { storage_used_bytes: number }[];
  if (!users.length) return;

  const newValue = (users[0].storage_used_bytes || 0) + deltaBytes;

  await fetch(restUrl(env, `users?id=eq.${userId}`), {
    method: "PATCH",
    headers: headers(env),
    body: JSON.stringify({ storage_used_bytes: newValue }),
  });
}
