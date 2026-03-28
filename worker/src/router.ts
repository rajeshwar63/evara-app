import { Env, InboundMessage } from "./types";
import { detectIntent } from "./utils";
import { handleImage } from "./handlers/image";
import { handleDocument } from "./handlers/document";
import { handleSearch } from "./handlers/search";
import { handleReminder } from "./handlers/reminder";
import { handleNote } from "./handlers/note";
import { handleGreeting } from "./handlers/greeting";

/**
 * Route an inbound message to the appropriate handler based on type and intent.
 */
export async function routeMessage(env: Env, message: InboundMessage): Promise<void> {
  // Media messages route by type
  if (message.type === "image") {
    return handleImage(env, message);
  }

  if (message.type === "document") {
    return handleDocument(env, message);
  }

  // Text messages route by detected intent
  const text = message.text?.trim() ?? "";
  const intent = detectIntent(text);

  switch (intent) {
    case "greeting":
      return handleGreeting(env, message);
    case "reminder":
      return handleReminder(env, message);
    case "search":
      return handleSearch(env, message);
    case "note":
      return handleNote(env, message);
  }
}
