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
  console.log(`[routeMessage] ENTER type=${message.type} from=${message.from}`);

  // Media messages route by type
  if (message.type === "image") {
    console.log(`[routeMessage] Routing to handleImage`);
    return handleImage(env, message);
  }

  if (message.type === "document") {
    console.log(`[routeMessage] Routing to handleDocument`);
    return handleDocument(env, message);
  }

  // Text messages route by detected intent
  const text = message.text?.trim() ?? "";
  const intent = detectIntent(text);
  console.log(`[routeMessage] Text intent detected: "${intent}" for text: "${text}"`);

  switch (intent) {
    case "greeting":
      console.log(`[routeMessage] Routing to handleGreeting`);
      return handleGreeting(env, message);
    case "reminder":
      console.log(`[routeMessage] Routing to handleReminder`);
      return handleReminder(env, message);
    case "search":
      console.log(`[routeMessage] Routing to handleSearch`);
      return handleSearch(env, message);
    case "note":
      console.log(`[routeMessage] Routing to handleNote`);
      return handleNote(env, message);
  }
}
