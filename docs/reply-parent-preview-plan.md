# Reply parent preview plan

In the Posts tab, the "Reply to #id" link on a reply previews its parent the way
a Citation previews its Cited Post in the Summary tab.

## Decisions

1. **Where the parent is looked up.** `replyTo.channel` when set; `post.channelName`
   when `replyTo` is absent; no lookup when `replyTo.url` is set but `channel` is
   null (a private parent).
2. **Parent not available** (not stored, an unfollowed Channel, or private): show
   Telegram's excerpt (`replyTo.text`) with a note that it is an excerpt and the
   full Post is not stored, plus Open in Telegram. No excerpt either: a not-found
   line plus Open in Telegram.
3. **What the preview shows.** The whole parent as a `PostCardView` with
   `wholeText`, as `CitedPostCard` does.
4. **One shell, two bodies.** Extract the hover-card-or-sheet shell from
   `SummaryCitation` into a shared `PostPreview` taking a trigger and a body.
   `SummaryCitation` passes its chip and `CitedPostCard`; `ReplyRef` passes its
   link and a new `ReplyParentCard`.
5. **Interaction, same as the Summary tab.** With hover on a wide screen, a
   `PreviewCard` after 150 ms; click still opens Telegram. With no hover or a
   narrow screen, a tap opens a bottom sheet. The native `title` is removed.
6. **The header line is unchanged.** "Reply to #id · excerpt" stays.
7. **Fetch on open.** `useQuery` keyed on (channel, id) in `hooks/queryKeys.ts`,
   enabled once the preview opens; no per-page prefetch.
8. **Nesting allowed.** A parent that is itself a reply previews its own parent.
   Fallback if it proves noisy: a plain link inside a preview.

## Checks

- Unit test for `ReplyParentCard` covering found, excerpt-only and not-found
  (the frontend CRAP ratchet needs it).
- `SummaryCitation` tests stay green after the extraction.
- A mocked Playwright spec for hover and the narrow-screen sheet.
