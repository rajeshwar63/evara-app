import { Env, OcrResult, ReminderParseResult, NoteTitleResult } from "./types";
import { OCR_PROMPT, DOCUMENT_PROMPT, REMINDER_PROMPT, NOTE_TITLE_PROMPT } from "./prompts";
import { safeParseJson } from "./utils";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

async function callGemini(env: Env, parts: unknown[]): Promise<string> {
  const url = `${GEMINI_BASE}?key=${env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}

/**
 * Send an image to Gemini Vision for OCR + tagging.
 */
export async function ocrImage(env: Env, imageBytes: ArrayBuffer, mimeType: string): Promise<OcrResult> {
  const base64 = arrayBufferToBase64(imageBytes);
  const parts = [
    { text: OCR_PROMPT },
    {
      inline_data: {
        mime_type: mimeType || "image/jpeg",
        data: base64,
      },
    },
  ];

  const text = await callGemini(env, parts);
  const result = safeParseJson<OcrResult>(text);
  if (!result) throw new Error("Failed to parse Gemini OCR response");
  return result;
}

/**
 * Send document text to Gemini for tagging/categorization.
 */
export async function tagDocument(env: Env, documentText: string): Promise<OcrResult> {
  const parts = [
    { text: DOCUMENT_PROMPT },
    { text: `Document content:\n${documentText}` },
  ];

  const text = await callGemini(env, parts);
  const result = safeParseJson<OcrResult>(text);
  if (!result) throw new Error("Failed to parse Gemini document response");
  return result;
}

/**
 * Parse a reminder from user text.
 */
export async function parseReminder(env: Env, userText: string): Promise<ReminderParseResult> {
  const prompt = REMINDER_PROMPT.replace("{current_datetime}", new Date().toISOString());
  const parts = [
    { text: prompt },
    { text: userText },
  ];

  const text = await callGemini(env, parts);
  const result = safeParseJson<ReminderParseResult>(text);
  if (!result) throw new Error("Failed to parse Gemini reminder response");
  return result;
}

/**
 * Generate a short title for a note.
 */
export async function generateNoteTitle(env: Env, noteText: string): Promise<string> {
  const parts = [
    { text: NOTE_TITLE_PROMPT },
    { text: noteText },
  ];

  const text = await callGemini(env, parts);
  const result = safeParseJson<NoteTitleResult>(text);
  return result?.title ?? noteText.slice(0, 30);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
