/**
 * PROTOTYPE (settings redesign), throwaway. Scope names and the hand-written
 * panels' metadata; every plain setting's metadata comes from the backend.
 */

export type Scope = "browser" | "account" | "deployment"

export const SCOPE_LABEL: Record<Scope, string> = {
  browser: "This browser",
  account: "My account",
  deployment: "Deployment",
}

export const SCOPE_HINT: Record<Scope, string> = {
  browser: "Saved in this browser only. Other devices keep their own value.",
  account: "Saved to your account. Follows you to every device.",
  deployment: "One value for everyone on this deployment. Admins set it.",
}

export type ProtoPanelId =
  | "ai-keys"
  | "setting-groups"
  | "jobs"
  | "bots"
  | "destinations"
  | "publication-options"
  | "proxy"
  | "tor"
  | "quick-message"

export const PANEL_INFO: Record<
  ProtoPanelId,
  { label: string; scope: Scope; blurb: string }
> = {
  "ai-keys": {
    label: "AI keys",
    scope: "account",
    blurb: "The keys your Summaries, Chats and Tags are paid with.",
  },
  "setting-groups": {
    label: "Setting groups",
    scope: "account",
    blurb: "Named bundles of sync settings you assign to channels.",
  },
  jobs: {
    label: "Background jobs",
    scope: "deployment",
    blurb: "Scheduled work the worker runs even when no browser is open.",
  },
  bots: {
    label: "Bots",
    scope: "account",
    blurb: "Telegram bots that publish your Summaries.",
  },
  destinations: {
    label: "Destinations",
    scope: "account",
    blurb: "Channels and chats your bots publish to.",
  },
  "publication-options": {
    label: "Publication options",
    scope: "account",
    blurb: "How a published Summary reads: citations, previews, time zone.",
  },
  "quick-message": {
    label: "Quick message",
    scope: "account",
    blurb:
      "Send a one-off message through one of your bots. Shows once you have a bot and a destination.",
  },
  proxy: {
    label: "Proxies",
    scope: "deployment",
    blurb: "Outbound proxies every sync goes through.",
  },
  tor: {
    label: "Tor",
    scope: "deployment",
    blurb: "Route syncs through Tor, with optional circuit rotation.",
  },
}
