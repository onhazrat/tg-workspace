# AW-09: Actions is where an Artifact begins

**What to build:** Give Artifact creation one entry point. Actions shows the
current Analysis window compactly and can hand off to the Posts editor and back
without losing an unfinished draft. Finish the effort with the one browser
journey that proves the pieces work together.

**Blocked by:** AW-04, AW-08

**Status:** done

## The rule this ticket makes true

Every UI-created Summary, Chat, Tag run and Discovery report starts in Actions,
and checking or changing the window from there is not destructive navigation.

## Acceptance criteria

- [x] Posts, History and the four result tabs no longer create Artifacts.
- [x] Actions shows the current Analysis-window summary as a compact control.
- [x] Activating that control navigates to Posts and opens the canonical editor.
- [x] The complete unfinished Action draft survives that navigation, and there is a direct path back.
- [x] One Playwright journey covers the integration rather than duplicating the temporal matrix: open the Posts summary, edit the four fields, switch modes, cross to Actions without losing the draft, create an Artifact, read its exact Start, End and Duration, confirm workspace Scope did not change, then Use this Scope and observe a Fixed restoration.
- [x] The same journey exercises keyboard closure and focus return on desktop and the bottom sheet at a mobile viewport.
- [x] It queries by role and label rather than styling classes.

## Notes

The browser seam is deliberately one journey. The temporal matrix belongs to the
controller tests in AW-03 and the backend contract tests in AW-05 and AW-06;
duplicating it here buys nothing and costs minutes on every run.

## What it took

Most of the first criterion was already true: Action has owned the four create
forms since the tab was introduced, and Posts and History never made an
Artifact. Two remainders were not. Chat's empty state offered three suggested
prompts, each of which started a conversation from the Chat tab with its own
idea of the Scope, and its composer answered even with no session behind it —
both are gone, and the composer now renders only where there is a conversation
to carry on. Summary's empty state described a create path that had not been on
that tab for months; it points at Action like Tag and Discover already did.

The draft that survives the trip is the chat question. It was `useState` in
`ActionView`, which the tab switch unmounts, so it moved to `ChatContext` as
`actionDraft` — separate from `chatInput`, which belongs to the Chat tab's
composer. Everything else on Action was already context-backed.

The compact control is `AnalysisWindowLink`, the same collapsed line the Posts
trigger draws, sharing its markup rather than copying it. It sets the tab and
raises a one-shot flag on `ScopeContext`; the editor consumes the flag on
arrival, which is what keeps a later walk onto Posts from finding the popover
opening by itself. Consuming it and gating the return button are both
mutation-tested.

The way back is a **Back to Action** button inside the editor, rendered only
when the opening came from Action. The nav keeps an Action tab at all times, but
it sits behind whichever overlay this is, and on a phone the sheet covers it
outright.

The journey deliberately uses **no network mocks**. `mockDiscoverForwardPosts`
stubs report creation with a canned frozen Scope, so a journey built on it would
assert the fixture's boundaries and pass however wrong the real freeze was. The
seeded channel is left empty on purpose: a report with no candidates still
carries a Scope, and the Scope is what is under test. Verified against the
database — the stored report's boundaries are exactly 2h apart, ending 30
minutes before submission.

Three defects came out of review, all in the seams this ticket cut:

A first turn that fails leaves no turns on screen at all, because
`handleSendMessage` writes them only after the session is opened — and the
catch then overwrote index `length - 1` of an empty array, which is a `"-1"`
property rather than an element. So the failure was invisible, and gating the
composer on a non-empty transcript would have turned that into a dead end with
the question already cleared from Action. Fixed at the root: an empty
transcript takes the failure as its first turn, and the composer also renders
while a chat is being started.

A related-post search replaces every filter on Posts, so it is the one place
the editor is not on screen to answer a request from Action. The request is
voided there; left standing, nothing would consume it until the search was
cleared and the popover would then open on a visit nobody asked it to.

**Back to Action** unmounts the editor without Radix ever seeing a close, so it
skipped the commit-and-discard that every other close runs and an invalid draft
survived to the next visit. It goes out through the same door now, and a test
holds it there.
