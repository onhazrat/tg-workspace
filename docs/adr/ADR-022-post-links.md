# ADR-022: A Post keeps its Links as positions over its plain text

**Status:** Accepted (2026-09-23). Spec: `.scratch/post-links/spec.md`. Ticket: LINK-01.

## Context

The scraper stores a Post's body as plain text, so every `<a href>` in it is reduced to its words.
A bare address survives as characters and a masked Link ("read more" over a URL) loses its
destination entirely. `Post.links` keeps some hrefs, but only Telegram-hosted ones, deduped by
Channel and without positions, because it exists to feed References
([ADR-019](./ADR-019-channel-reference-graph.md)). The feed linked `@mentions` and nothing else.

## Decision

**A Post's Links are stored as positions over `Post.text`, in a new `link_spans` column**:
`[{offset, length, url}]`, one entry per anchor in the Post's own body, href verbatim.

- **Positions count UTF-16 code units**, the unit JS slices in and Telegram's own API uses. Python
  indexes code points, so the two differ by one for every emoji before a Link, and a row written in
  one unit cannot be reinterpreted in the other.
- **The href is stored as Telegram wrote it.** Sending Telegram addresses to the configured web
  view or mirror domain happens at render time, so no row bakes in a deployment setting.
- **`links` stays beside it, unchanged.** It is the Reference graph's input, the upsert's change
  detection and part of the export format; `link_spans` is display data. The overlap is
  deliberate: a rendering defect cannot reach Discovery.
- **Nothing rescrapes.** Posts stored before this ADR keep `link_spans = NULL`, and the renderer
  falls back to a regex for them (mentions, `http(s)://` URLs, `t.me` paths). Masked Links in those
  Posts are lost for good.

## Considered options

- **Sanitised HTML of the body.** It keeps formatting for free, but it is a second copy of every
  body that can drift from `Post.text`, which search, embeddings, translation, Language detection
  and Reference extraction all read. It also puts `dangerouslySetInnerHTML` over content scraped
  from arbitrary Channels.
- **Replace `links` with the full Link list.** One column, but it rewires the Reference graph and
  changes the export format in the same change that fixes a rendering bug.
- **Rescrape the stored corpus.** At about 20 Posts per page, the staging corpus of 4.68M Posts
  costs roughly 234k Requests against Budgets and sync lanes, and recovers only what Telegram still
  serves.

## Consequences

- A translated Post has no positions, so it renders with the regex fallback and loses its masked
  Links; showing the original gets them back.
- An upsert that changes a Post's text without carrying new positions clears `link_spans`, because
  positions measured against other words would link the wrong ones.
- Directory samples and search previews still render plain text.
