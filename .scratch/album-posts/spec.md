# Album Posts: each message of an Album is its own Post

Status: done (every ticket closed; closed 2026-11-03)

Ticket prefix: `ALB`.

Settled in a grilling session on 2026-11-02, held for the Reply chain
(`.scratch/posts-reply-chain/`), which builds on this. The decision record is
ADR-046; the terms are **Album**, **Post**, **Reply** and **Reply chain** in
`GLOSSARY.md`. The brief this spec came from is `.scratch/album-posts/brief.md`.

## Problem Statement

A Channel often posts several photos or videos together, and Telegram shows
them as one message, an Album. The workspace stores an Album as one Post under
its first message's id, so the other photos have no Post. When a Post answers
the third photo of an Album, its parent cannot be found: the reply preview says
"not stored" and a Reply chain stops there, although the Album is in the
workspace. On staging, 750 of the 48,502 replies whose parent could be looked
up answer such a photo. The workspace's ids also stop matching Telegram's, so a
link or a Pick can never name one photo.

## Solution

Every Telegram message becomes its own Post, Album photos included. Each Post
of an Album knows its Album. The caption, views, reactions, forward and reply,
which Telegram gives once for the whole Album, stay on the Album's first Post;
the other Posts carry their own photo. A reply to any photo finds its parent,
and a Reply chain through an Album continues from the Album's first Post.
Albums already stored as one Post are re-scraped and split. In the Posts feed
each Post is its own card for now, and a later Album Post says which Album it
belongs to ("Album · 2 of 4").

## User Stories

1. As a reader, I want a reply to any photo of an Album to show its parent, so
   that the reply preview never says "not stored" for a Post the workspace has.
2. As a reader, I want a Reply chain to continue through an Album, so that a
   chain does not stop at a photo that answers nothing on its own.
3. As a reader, I want every photo of an Album to be a Post with its own
   picture, so that I can see each one, not only the first.
4. As a reader, I want a later Album Post's card to say "Album · 2 of 4", so
   that a card with a photo and no text explains itself.
5. As a reader, I want the Album's caption, views and reactions on its first
   Post, so that I read them once, as Telegram shows them.
6. As a reader, I want the shown count to match the cards on screen, so that
   a count of 10 never sits over 13 cards.
7. As a reader, I want the per-Channel cap to count each Post, so that the cap
   works the same way whatever a Post holds.
8. As a reader, I want an Album's views counted once in estimated views and
   reach, so that a photo-heavy Channel does not look more widely read than it
   is.
9. As a reader, I want "Is a reply" to show one card for an Album that answers
   something, so that one reply never appears as four.
10. As a reader, I want "Has a reply" to mark the photo that was answered, so
    that the Post filter agrees with Telegram about which message has the
    reply.
11. As a reader, I want to Pick one photo of an Album, so that a Summary can
    cover exactly what I chose.
12. As a reader, I want a Summary of an Album to read its caption once, so
    that the prompt does not repeat empty photo entries.
13. As a reader, I want Find related to ignore photo-only Album Posts, so that
    empty placeholders never come back as related.
14. As a reader, I want a link to one photo (`/<id>?single`) to open that
    photo's Post, so that the workspace's ids match Telegram's.
15. As a reader, I want Albums stored before this change to be split too, so
    that older replies to their photos resolve as well.
16. As a reader, I want an Album whose page can no longer be fetched to stay
    as it is, so that I never get a Post without its photo.
17. As a reader, I want a video in an Album to be its own Post with its own
    thumbnail and duration, so that videos are not lost inside an Album.
18. As a reader, I want Album Posts to share the Album's date, so that they
    sit together in the feed and fall inside or outside a window together.
19. As an Operator, I want the sync to record an Album's last id as walked
    when a newest page ends with one, so that the sync does not think the
    rest of the Album is still to be walked.
20. As an Operator, I want the sync's per-Channel cap to count each Post, so
    that one rule holds for every Post count and I can raise the default if
    Channels reach it more often.
21. As an Operator, I want the split of stored Albums to run within retention
    through the sync's own page walks, so that it uses the same Requests and
    limits as any sync.
22. As an Operator, I want posting pace and the window check to count each
    Post, so that the counts the sync judges by match the counts the reader
    sees.
23. As an Operator, I want the Directory's posts per week to keep its meaning
    for followed Channels, so that the split changes no Directory number for
    Channels the workspace does not store.
24. As a reader, I want retention to remove an Album's Posts together, so
    that no Album is left with only some of its photos.
25. As a reader, I want References to come from the Album's caption once, so
    that citing Channels does not count an Album several times.

## Implementation Decisions

- **One Post per message.** The scraper turns each item of an Album's grouped
  wrap into its own Post. The item's own id comes from its `?single` link, its
  thumbnail from the item (a photo's background image, a video's thumb), and a
  video's duration from the item. The widget's `data-post` is the first id.
- **Album membership** is a new nullable column on Post holding the Album's
  first message id; it is null for a Post outside an Album and equal to the
  Post's own id on the first Post. The photo count in the media JSON becomes
  redundant for split Albums; "2 of 4" is the Post's place among its Album's
  Posts. An Alembic migration adds the column.
- **Shared values on the first Post only**: caption text, views, reactions,
  forward, reply and Links. Later Album Posts carry their own id, thumbnail
  (and video duration) and the Album's date, with no text of their own and no
  views. Nothing shared is copied, so sums, References and embeddings count an
  Album once.
- **Counting**: every Post counts as a Post in shown counts, selected counts,
  the per-Channel cap, Channel posts in window, Summary Post counts, posting
  pace, the window check and the sync's per-Channel cap. Reach and estimated
  views use only Posts with views, so later Album Posts change neither.
- **Reply semantics**: only the first Post carries the reply, so only it is a
  reply for the Post filter's Type. A reply to a later Album Post makes that
  Post the one that has a reply. Wherever a Reply chain or a parent lookup
  climbs from a later Album Post, it climbs from its Album's first Post.
- **Summaries and embeddings**: prompt assembly gives a later Album Post no
  block of its own; the first Post's block keeps its "Album: N items" line.
  Later Album Posts get no embedding.
- **Picks** stay per Post: picking a photo picks that photo.
- **Splitting stored Albums**: a one-off job, within retention, walks the
  pages that hold Posts with a photo count above one through the sync's page
  fetch and writes the missing Posts, filling Album membership on all of them.
  An Album whose page fails or no longer shows the Album stays one Post, and
  the job says how many it split and how many it left. It is resumable and
  idempotent: running it twice writes nothing the second time.
- **Walked ids**: a newest page whose newest widget is an Album records the
  Album's last id as the newest id walked.
- **Retention** removes an Album's Posts together; they share a timestamp.
- **Frontend**: one card per Post. A Post with Album membership other than
  the first shows an "Album · 2 of 4" badge in place of today's " (n)" count;
  the first Post shows "Album · 1 of 4". The API exposes Album membership and
  the Album's size on Posts.
- **Directory**: posts per week for Directory entries is unchanged; it reads
  preview samples, not stored Posts.

## Testing Decisions

- A good test drives the system from its edge and checks what a reader or an
  Operator would see: stored Posts and their fields, counts, rendered cards.
  It never asserts on private helpers or query shapes.
- **Seam 1, the sync with fixture pages (primary).** Prior art: the walked
  ranges and Complete window sync tests, which drive a Channel's sync with a
  fake `fetch(before_id)` page source. Feed it the saved live fixtures with
  Albums (durov 373-381 with a video, durov 510-511, TelegramTips 244-245) and
  assert: one Post per message; Album membership on each; caption, views,
  reactions and reply on the first Post only; each Post's own thumbnail and a
  video's duration; the Album's last id recorded as walked on a newest page;
  the split job turning a stored one-Post Album into its Posts, leaving one
  whose page fails, and writing nothing on a second run.
- **Seam 2, the Posts reads.** Prior art: the posts counts and posts view
  service tests with seeded Posts. Assert: shown and selected counts and the
  per-Channel cap count every Post; Channel posts in window counts every
  Post; "Is a reply" matches only the first Post of an answering Album; "Has
  a reply" marks the answered photo; estimated views and reach are unchanged
  by later Album Posts; a parent lookup and a climb from a later Album Post
  continue from its Album's first Post.
- **Seam 3, the post card render.** Prior art: the PostCard component tests.
  Assert the "Album · 2 of 4" badge on a later Album Post and "Album · 1 of 4"
  on the first.
- Prompt assembly gets one assertion in the existing prompts tests: a later
  Album Post adds no block. The embedding candidate query gets one assertion
  that later Album Posts are not candidates.

## Out of Scope

- One card per Album in the feed, grouping its Posts back together.
- Replies downward (the replies a Post has, as a list).
- The Reply chain itself (`.scratch/posts-reply-chain/`), which builds on this.
- Albums outside retention, and Channels no longer followed.

## Further Notes

- Staging on 2026-11-02: 629,739 Posts; 18,084 Albums standing for 66,058
  messages, so about 48,000 more Posts (+7.6%), most of them photo-only.
- The saved fixtures show consecutive Album ids with `data-post` the first.
  Which item Telegram attaches the caption to is not confirmed; the caption
  stays on the first Post whatever the page says.
- Watch the sync's per-Channel cap after the split; raise its default if
  Channels reach it more often.
