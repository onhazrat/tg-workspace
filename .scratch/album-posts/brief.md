# Album Posts: brief for the spec

Input for `/to-spec`, then `/to-tickets` (prefix **ALB**). Every decision below
was settled in a grilling session on 2026-11-02, held for the Reply chain
(`.scratch/posts-reply-chain/brief.md`), which this effort ships before.
The decision record is ADR-046; the terms are **Album** and **Post** in
`GLOSSARY.md`.

## Why

A Channel's preview page shows an Album as one message, and the sync stores it
as one Post under the first message's id with a photo count
(`media.groupedCount`). Telegram gives each photo its own id, so a reply to an
Album's third photo names an id no Post has, and its Reply chain stops at "not
stored".

Staging, 2026-11-02 (read-only):

| | Count |
|---|---|
| Posts | 629,739 |
| Albums stored as one Post | 18,084, standing for 66,058 messages |
| Replies whose parent can be looked up | 48,502 |
| ... parent stored | 45,520 (94%) |
| ... parent is an Album photo other than the stored one | 750 (1.5%) |

Splitting adds about 48,000 Posts (+7.6%), mostly photo-only.

## What the page gives (from the saved fixtures)

- Per photo or video (`a.grouped_media_wrap`): its own id in
  `href=".../<id>?single"`, its own thumbnail, and for a video its `<video src>`
  and duration.
- Once per Album: caption, views, date, reactions, forward, reply.
- `data-post` is the first id; ids are consecutive in every saved Album
  (durov 373-381 with a video, durov 510-511, TelegramTips 244-245).
- Fixtures with Albums: `backend/tests/fixtures/live/` durov_root, durov_400,
  durov_512, durov_513, TelegramTips_246, TelegramTips_258.

## Decisions

1. **One Post per Telegram message.** An Album of N photos is N Posts with N ids.
2. **Album membership**: each Post of an Album records the Album by its first
   message's id (from `data-post`); null outside an Album. There is no such
   column today; the only Album facts live in the `media` JSON.
3. **Shared values on the first Post only**: caption, views, reactions,
   forward and reply. Every Post carries its own id and thumbnail (and video
   duration) and the Album's date. Duplicating them would multiply views in
   sums and the caption in References and embeddings.
4. **Every Post counts everywhere**: shown counts, the per-Channel cap,
   Channel posts in window, Summary Post counts, posting pace. A count always
   matches the cards on screen.
5. **The sync's own cap** (`SCRAPER_MAX_POSTS_PER_CHANNEL`) counts Posts too,
   so an Album of 10 uses 10. Raise the default if staging shows Channels
   hitting it more often.
6. **One card per Post in the feed for now**, a photo-only card for later
   Album Posts, with a small "Album · 2 of 4" badge.
7. **Reply chains**: a later Album Post climbs as its Album's first Post,
   which holds the reply. Only the first Post is a reply for the Post filter's
   Type ("Is a reply"), so one reply never shows as N cards. (Used by RCH-02.)
8. **Existing Albums are re-scraped** within retention through the sync's page
   walks, so each photo gets its own Post and thumbnail. An Album whose page
   fails stays one Post; no Post is made without its thumbnail.
9. **Newest id walked**: a newest page ending in an Album records the Album's
   last id, not its first (today `sync_orchestrator.py` records `data-post`).

## Places the split touches (from a code survey; verify each)

- Scraper: one Post per widget, `scraper.py` ~72-89; cap at ~576 and ~605.
- Media parser keeps only a count, the first thumbnail and the first duration:
  `post_media_parser.py` ~84, ~100-123, ~126-132.
- Per-Channel cap: `post_filters.py` `ranked_per_channel` ~468-493 and
  `posts_view.py` ~228-232.
- Counts: `posts_view.py` `count_shown` ~297-336, `count_selected` ~339;
  `schemas/scope.py` ~224-260 (Summary `post_count`).
- Window check `_held` (`window_check.py` ~70-89) and posting pace
  (`sync_orchestrator.py` ~1110-1127, feeds Unproven Posts).
- Reach median `channels.py` ~300-330 and estimated views
  `post_filters.py` ~829: must skip later Album Posts' empty views (decision 3).
- Prompt assembly `prompts/posts.py` ~54-97 ("Album: N items" block) and
  embeddings `embeddings.py` ~38-58: text-less Posts add nothing.
- Picks are `(channel_name, post_id)`: a Pick now names one photo.
- Directory `posts_per_week` (`directory_statistics.py` ~160-175).
- Frontend: one card per Post (`PostCardView.tsx`), the badge replaces the
  " (n)" count from `groupedCount` (`post-card-model.ts` ~9-12).

## Out of scope

- One card per Album in the feed (a later choice once the data is split).
- Replies downward (who answered a Post).
