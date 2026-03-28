// === Environment ===

export interface Env {
  EVARA_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  GEMINI_API_KEY: string;
  META_ACCESS_TOKEN: string;
  META_PHONE_NUMBER_ID: string;
  WEBHOOK_VERIFY_TOKEN: string;
}

// === Inbound Webhook (Meta WhatsApp Cloud API) ===

export interface InboundMessage {
  messageId: string;
  from: string;        // phone number e.g. "919398574255"
  type: "text" | "image" | "document";
  text?: string;
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  timestamp?: string;
}

// === Meta Webhook Types ===

export interface MetaWebhookBody {
  object: string;
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id: string;
  changes: MetaWebhookChange[];
}

export interface MetaWebhookChange {
  value: MetaWebhookValue;
  field: string;
}

export interface MetaWebhookValue {
  messaging_product: string;
  metadata: {
    phone_number_id: string;
    display_phone_number: string;
  };
  messages?: MetaWebhookMessage[];
  statuses?: unknown[];
}

export interface MetaWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "image" | "document" | "audio" | "video" | "sticker" | "location" | "contacts";
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256?: string; caption?: string };
  document?: { id: string; mime_type: string; sha256?: string; filename?: string; caption?: string };
}

// === Message Intent ===

export type MessageIntent = "image" | "document" | "search" | "reminder" | "note" | "greeting";

// === Gemini OCR Response ===

export interface OcrResult {
  category: string;
  title: string;
  extracted_text: string;
  tags: string[];
  amount?: string;
  date_detected?: string;
  expiry_date?: string;
  organization?: string;
  person_name?: string;
  document_type?: string;
  language_detected?: string;
  confidence: number;
  whatsapp_reply: string;
}

// === Gemini Reminder Parse Response ===

export interface ReminderParseResult {
  task: string;
  date: string;       // ISO date string
  time: string;       // HH:mm format
  raw_datetime: string;
}

// === Gemini Note Title Response ===

export interface NoteTitleResult {
  title: string;
}

// === Supabase User ===

export interface User {
  id: string;
  phone_number: string;
  name?: string;
  storage_used_bytes: number;
  created_at?: string;
}

// === Supabase Document ===

export interface Document {
  id?: string;
  user_id: string;
  file_key?: string;
  file_url?: string;
  file_type?: string;
  file_size_bytes?: number;
  message_type: "image" | "document" | "text_note";
  category?: string;
  title?: string;
  extracted_text?: string;
  tags?: string[];
  amount?: string;
  date_detected?: string;
  expiry_date?: string;
  organization?: string;
  person_name?: string;
  document_type?: string;
  language_detected?: string;
  confidence?: number;
  original_message_id?: string;
  created_at?: string;
}

// === Supabase Reminder ===

export interface Reminder {
  id?: string;
  user_id: string;
  task: string;
  remind_at: string;  // ISO timestamp
  status?: "pending" | "sent";
  original_text?: string;
  created_at?: string;
}

// === Search Result ===

export interface SearchResult {
  id: string;
  file_key?: string;
  file_url?: string;
  title?: string;
  category?: string;
  extracted_text?: string;
  tags?: string[];
  message_type: string;
  similarity?: number;
  created_at?: string;
}
