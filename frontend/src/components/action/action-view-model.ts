/**
 * When the Action tab's two own buttons can be pressed, with no React, so it
 * can be tested. `ActionView` renders it.
 */

/** Generate report: needs the server and at least one channel in scope. */
export function discoverButton(state: {
  isGenerating: boolean
  isOffline: boolean
  channelCount: number
}): { disabled: boolean; label: string } {
  return {
    disabled: state.isGenerating || state.isOffline || state.channelCount === 0,
    label: state.isGenerating ? "Generating…" : "Generate report",
  }
}

/**
 * Start a chat: needs a question, the server and an AI Key, and not a chat
 * already starting. Only a missing Key gets a tooltip, because it is the one
 * reason the tab itself cannot show.
 */
export function startChatButton(state: {
  draft: string
  isChatting: boolean
  isOffline: boolean
  noKey: boolean
}): { disabled: boolean; title: string | undefined } {
  return {
    disabled:
      !state.draft.trim() || state.isChatting || state.isOffline || state.noKey,
    title: state.noKey ? "Add an AI key above to run this." : undefined,
  }
}
