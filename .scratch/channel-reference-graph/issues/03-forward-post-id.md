# CRG-03: A forward records which Post it came from

**Status:** ready-for-agent

**Blocked by:** CRG-01

## What to build

A newly scraped forward stores which Post in the source channel it came from, so
a forward Reference is as explorable as a link one. Runs in parallel with CRG-02.

## The gap

The scraper reads a forward's href, resolves the handle out of it and never keeps
the href. So a forward knows which channel it came from and not which Post.

A link does better by accident. Its parser discards the id segment too, but the
raw href survives verbatim on the Post's links blob, so the id is recoverable
there. A forward's href is recoverable from nowhere.

CRG-01 already added the helper that returns both the channel and the post id.
This ticket is the two columns and the scrape-time parsing that feed it.

## Scope

A nullable forwarded-from post id on the Post model and on the Directory sample
model, populated at scrape time. The two models are deliberately parallel here,
the way the sample model already mirrors the Post's links and reply fields.

A forward from a private channel or an invite link yields a reserved first
segment rather than a followable handle, and the scraper already refuses to store
those as a channel. The post id is worth nothing without a usable handle, so the
pair is refused together.

The extractor from CRG-01 reads the new column for a forward's target post id.

## What this cannot do

It only helps Posts scraped after it deploys. Every forward already in the corpus
keeps a null forwarded-from post id permanently, because its href was never
stored anywhere. There is no source for a backfill. Say so in the migration's
docstring so the next person does not go hunting for one.

## Acceptance criteria

- [ ] A scraped forward stores its source post id, asserted from fixture html in
      the shape the reply parser's tests take
- [ ] A Directory sample does the same
- [ ] A forward from a reserved path stores neither a channel nor a post id
- [ ] A forward Reference carries the target post id, and one scraped before this
      change still carries null
- [ ] The migration adds two nullable columns and no backfill, and says why
- [ ] Every new assertion mutation-tested
