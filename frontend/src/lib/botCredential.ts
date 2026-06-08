import type { BotCredential } from "@/types";

export function stripToken(bot: BotCredential): BotCredential {
  const { token: _token, ...rest } = bot;
  return rest;
}
