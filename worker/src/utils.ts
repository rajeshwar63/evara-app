import { MessageIntent } from "./types";

const GREETING_PATTERNS = /^(hi|hello|hey|help|start|menu|hola|namaste)$/i;

const REMINDER_PATTERNS =
  /\b(remind|reminder|yaad|yaad dila|alert me|notify me|kal|parso|tomorrow|next week|next month|(\d{1,2})\s*(am|pm)|at\s+\d{1,2})/i;


/**
 * Detect the intent of a text message.
 */
export function detectIntent(text: string): MessageIntent {
  const trimmed = text.trim();
  if (!trimmed) return "greeting";

  if (GREETING_PATTERNS.test(trimmed)) return "greeting";
  if (REMINDER_PATTERNS.test(trimmed)) return "reminder";

  // If it's short (1-4 words) and looks like a noun phrase, treat as search
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 4 && !trimmed.endsWith(".") && !trimmed.endsWith("!")) return "search";

  // Longer text → note
  return "note";
}

/**
 * Generate a UUID v4 using crypto.randomUUID() (available in Workers).
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get file extension from MIME type or filename.
 */
export function getFileExtension(mimeType?: string, fileName?: string): string {
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext) return ext;
  }
  const mimeMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  };
  return mimeMap[mimeType ?? ""] ?? "bin";
}

/**
 * Format bytes into a readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Safely parse JSON, returning null on failure.
 */
export function safeParseJson<T>(text: string): T | null {
  try {
    // Try to extract JSON from markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = jsonMatch ? jsonMatch[1].trim() : text.trim();
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
