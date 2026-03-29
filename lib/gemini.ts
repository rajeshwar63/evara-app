const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

// ─── Generic Gemini call ──────────────────────────────────────
async function callGemini(parts: any[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY!;

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[gemini] API error ${res.status}:`, errText);
    throw new Error(`Gemini API failed: ${res.status}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.trim();
}

// ─── OCR: Extract text from image/PDF ─────────────────────────
export async function ocrDocument(
  base64Data: string,
  mimeType: string
): Promise<{
  text: string;
  category: string;
  title: string;
  tags: string[];
}> {
  const prompt = `You are a document OCR and classification assistant for Indian users.

Extract ALL text from this document. Then classify it.

Respond in this EXACT JSON format (no markdown, no code fences):
{
  "text": "full extracted text here",
  "category": "one of: bill, receipt, invoice, insurance, medical, government_id, certificate, bank_statement, tax, warranty, ticket, letter, other",
  "title": "short descriptive title like 'Electricity Bill - March 2026' or 'Aadhaar Card'",
  "tags": ["tag1", "tag2", "tag3"]
}

Rules:
- Extract text in whatever language it appears (Hindi, Telugu, English, etc.)
- For bills/receipts, include amounts, dates, vendor names
- Title should be human-readable and specific
- Tags should include: document type, vendor/issuer if visible, month/year if visible
- If text is unreadable, set text to "" and category to "other"`;

  const parts = [
    {
      inlineData: {
        mimeType,
        data: base64Data,
      },
    },
    { text: prompt },
  ];

  const rawResponse = await callGemini(parts);

  try {
    // Strip any markdown code fences if present
    const cleaned = rawResponse
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      text: parsed.text || "",
      category: parsed.category || "other",
      title: parsed.title || "Untitled Document",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch (err) {
    console.error("[gemini] Failed to parse OCR response:", rawResponse);
    return {
      text: rawResponse,
      category: "other",
      title: "Untitled Document",
      tags: [],
    };
  }
}

// ─── Classify text intent ─────────────────────────────────────
export async function classifyTextIntent(
  text: string
): Promise<{
  intent: "reminder" | "note" | "search";
  reminder_title?: string;
  reminder_datetime?: string;
  note_title?: string;
}> {
  const now = new Date().toISOString();

  const prompt = `You are a WhatsApp assistant for Indian users. Classify this message intent.

Current datetime: ${now}

User message: "${text}"

Classify as ONE of:
1. "reminder" — user wants to be reminded about something (contains words like "remind", "yaad", "alert", tomorrow, specific date/time)
2. "note" — user wants to save this as a note/text for future reference
3. "search" — user is searching for a previously saved document (asking about a bill, receipt, document)

Respond in EXACT JSON (no markdown, no code fences):

For reminder:
{"intent": "reminder", "reminder_title": "short title", "reminder_datetime": "ISO 8601 datetime"}

For note:
{"intent": "note", "note_title": "short title for the note"}

For search:
{"intent": "search"}

Rules:
- Parse Indian date formats: "kal" = tomorrow, "parso" = day after tomorrow
- Parse times like "subah 8 baje" = 08:00, "shaam 5 baje" = 17:00
- If unsure between note and search, pick "search"
- reminder_datetime must be a valid ISO 8601 string`;

  const rawResponse = await callGemini([{ text: prompt }]);

  try {
    const cleaned = rawResponse
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[gemini] Failed to parse intent:", rawResponse);
    // Default to search
    return { intent: "search" };
  }
}
