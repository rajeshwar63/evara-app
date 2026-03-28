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
  const res = await fetch(restUrl(env, "users"), {
    method: "POST",
    headers: headers(env, {
      Prefer: "return=representation,resolution=merge-duplicates",
    }),
    body: JSON.stringify({
      phone_number: phone,
      storage_used_bytes: 0,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert user error ${res.status}: ${err}`);
  }

  const users = (await res.json()) as User[];
  return users[0];
}

/**
 * Insert a document record.
 */
export async function insertDocument(env: Env, doc: Document): Promise<Document> {
  const res = await fetch(restUrl(env, "documents"), {
    method: "POST",
    headers: headers(env, { Prefer: "return=representation" }),
    body: JSON.stringify(doc),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase insert document error ${res.status}: ${err}`);
  }

  const docs = (await res.json()) as Document[];
  return docs[0];
}

/**
 * Insert a reminder record.
 */
export async function insertReminder(env: Env, reminder: Reminder): Promise<Reminder> {
  const res = await fetch(restUrl(env, "reminders"), {
    method: "POST",
    headers: headers(env, { Prefer: "return=representation" }),
    body: JSON.stringify(reminder),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase insert reminder error ${res.status}: ${err}`);
  }

  const reminders = (await res.json()) as Reminder[];
  return reminders[0];
}

/**
 * Search documents using the search_documents RPC function.
 */
export async function searchDocuments(env: Env, userId: string, query: string): Promise<SearchResult[]> {
  const res = await fetch(restUrl(env, "rpc/search_documents"), {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      p_user_id: userId,
      p_query: query,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase search error ${res.status}: ${err}`);
  }

  return (await res.json()) as SearchResult[];
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
