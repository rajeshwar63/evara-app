import { sendTextMessage } from "../whatsapp";

export async function handleGreeting(
  from: string,
  senderName: string
): Promise<void> {
  const name = senderName?.split(" ")[0] || "there";

  const welcome = `👋 Hi ${name}! Welcome to *Evara* — your personal document organizer on WhatsApp.

Here's what I can do:

📸 *Send a photo* of any document (bill, receipt, Aadhaar, PAN, etc.) — I'll read it, organize it, and save it for you.

📄 *Send a PDF* — same magic, I'll extract all the text and file it.

📝 *Type a note* — I'll save it for you. Just write naturally, like "Note: Rent paid ₹15,000 for March".

⏰ *Set a reminder* — "Remind me to renew insurance on April 15" or "Kal subah 8 baje yaad dilao gym jaana hai".

🔍 *Search your docs* — "Find my electricity bill" or "Show Aadhaar" — I'll find it instantly.

Just send me something to get started! 🚀`;

  await sendTextMessage(from, welcome);
}
