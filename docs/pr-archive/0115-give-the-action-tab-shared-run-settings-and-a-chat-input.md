# #115 ✨ Give the Action tab shared run settings and a chat input

**State:** merged 2026-08-20 · **Branch:** `action-tab-run-settings-and-chat-input` into `main` · **Diff:** +482 / -283 across 11 files · **Opened:** 2026-08-20

---

Three changes to the one page where work starts.

## Model and language move to the top

They lived inside the Summary card while `AIContext`, `TagContext` and `ChatContext` all read the same two `useSettings` values. The state was always shared; only the placement said otherwise, so picking a model for a tag run meant opening the summary form to set it. `RunSettingsBar` now sits above all four cards.

Discover is honestly excluded from "all four": its report is a server-side aggregation with no inference in it, so neither selector reaches it.

## Chat starts with its first question

A chat only exists once someone has asked something, so the launcher button became a message box. The Chat tab keeps its own composer for every turn after that.

Sending from outside the composer needed a seam. `handleSendMessage` read the message, the history and the session id from state captured before the caller's render — so clearing the transcript and the id in the caller could not work. The new question would be sent after the last conversation's turns, and saved **over** that conversation, because the session payload replaces `messages` wholesale.

`resolveSend` takes all three explicitly, using a presence check rather than `??`: `null` and `[]` are the meaningful values here, and `??` cannot tell an explicit empty from an omission. Mutation-tested in both directions — swapping the presence check for `??` fails 2 of 6.

## The duplicated counts are gone

"N channels selected" on the Tag card and "N channels scanned" on Discover both restated the workspace header's **Active Channels**, as did the scope line above the cards. Two copies of one number invite the reader to check whether they agree. The e2e that asserted the old text now asserts the header instead.

## One bug found by the compiler

`onClick={handleSendMessage}` was passing a `MouseEvent` as the first argument. Harmless while the function took none; a type error the moment it did.

## Verification

- `tsc --noEmit` — 0 errors
- `bun test src` — 846 pass, 0 fail
- Full e2e — **135 passed, 7 failed**, and all 7 fail identically on a clean tree: admin edit user, items edit, reset-password ×2, theme switch, K9 and K15

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016Mjy4LiaHo6ZPpCcDE4QYf
