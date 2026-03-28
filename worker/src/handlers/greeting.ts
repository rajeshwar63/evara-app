import { Env, InboundMessage } from "../types";
import { sendTextReply } from "../whatsapp";
import { WELCOME_MESSAGE } from "../prompts";

export async function handleGreeting(env: Env, message: InboundMessage): Promise<void> {
  await sendTextReply(env, message.from, WELCOME_MESSAGE);
}
