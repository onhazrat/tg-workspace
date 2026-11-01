# ADR-046: Each message of an Album is its own Post

**Status:** Accepted (2026-11-02). Decided in a grilling session for the Reply
chain; spec and tickets (ALB) in `.scratch/album-posts/`.

## Context

A Channel's preview page shows an Album, several photos or videos sent
together, as one message, and the sync stored it as one Post under the first
message's id with a photo count. Telegram gives every photo its own message id,
so a reply to the third photo of Album #531145 names #531147, which no Post
had. On staging on 2026-11-02, 18,084 Albums stood for 66,058 messages, and
750 of the 48,502 replies whose parent could be looked up (1.5%) answered an
Album photo other than the stored one, so their Reply chain stopped at
"not stored".

The page carries each photo's own id (`/<id>?single`), thumbnail and, for a
video, duration. The caption, view count, date, reactions, forward and reply
appear once for the whole Album, and `data-post` is the first id. Album ids
are consecutive in every saved page.

## Decision

Every Telegram message is its own Post, Album photos included:

- Each Post of an Album records the Album by its first message's id.
- The caption, views, reactions, forward and reply live on the first Post
  only; every Post carries its own id and thumbnail and the Album's date.
  Copying the shared values onto every Post would count one Album's views N
  times in sums and its caption N times in References and embeddings.
- Every Post counts as a Post everywhere: shown counts, the per-Channel cap,
  Channel posts in window, Summary Post counts and the sync's own cap. A count
  always matches the cards on screen, where for now each Album Post is its own
  card marked "Album · 2 of 4".
- A Reply chain climbs from a later Album Post as from its first Post, which
  holds the reply. Only the first Post is a reply for the Post filter's Type.
- Albums stored as one Post are re-scraped within retention so each photo
  gets its own Post; one whose page fails stays as it was.
- A newest page ending in an Album records the Album's last id as walked.

## Consequences

About 48,000 more Posts on staging (+7.6%), most of them photo-only, in
photo-heavy Channels. Counts grow there, and an Album of 10 photos uses 10 of
the sync's per-Channel cap. Replies to any Album photo resolve without a
lookup rule.

## Alternatives rejected

- **One Post per Album, with a lookup rule**: an id inside an Album's range
  resolves to its first Post. It needs no schema change, but every lookup has
  to know the rule, ids stop matching Telegram, and a Pick or a link can never
  name one photo.
- **Splitting only new Albums**: cheaper, but replies to stored Albums would
  stay broken until retention removed them.
- **Counting an Album as one while showing one card per photo**: a shown count
  of 10 above 13 cards.
