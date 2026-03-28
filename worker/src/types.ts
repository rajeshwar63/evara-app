// === Environment ===

export interface Env {
  EVARA_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  GEMINI_API_KEY: string;
  AISENSY_API_KEY: string;
}

// === Inbound Webhook (AiSensy) ===

export interface InboundMessage {
  messageId: string;
  from: string;        // phone number e.g. "918309421405"
  type: "text" | "image" | "document";
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  fileName?: string;
  timestamp?: string;
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

// === AiSensy Reply ===

export interface AiSensyReplyOptions {
  destination: string;
  message?: string;
  mediaUrl?: string;
  mediaFilename?: string;
}
