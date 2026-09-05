# 02: Sample Posts

**What to build:** A Directory entry keeps a sample of the Channel's recent Posts, so an Operator can judge what a Channel actually publishes before following it. The samples expire on their own window; the map itself never does.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Channel info fetching takes a flag for whether to also parse the preview page's Posts; only the probe sets it
- [ ] With the flag off the result carries no samples key at all, and latest-post-id derivation is identical either way
- [ ] Sample media is parsed, bringing view and reaction counts along, but no media is downloaded and thumbnail paths are **not** rewritten to local cache paths
- [ ] Samples live in their own table keyed by handle and post id, never in `tg_posts`, so no corpus query needs an exclusion predicate
- [ ] One aggregate module is that table's sole writer, declares its service kind, and does not commit — the caller owns the transaction
- [ ] A conclusive probe replaces the handle's samples wholesale, so a Post that fell off the preview window stops being reported as recent
- [ ] A payload with **no samples key** leaves an existing snapshot untouched — it came from a fetch that never parsed them, and is not an empty sample set
- [ ] An inconclusive fetch touches nothing; an unavailable verdict clears the samples
- [ ] A recheck resets the verdict fields and keeps the samples; the next conclusive probe replaces them
- [ ] Samples expire on their own deployment-policy window, separate from log and corpus retention; Directory metadata is never collected by age
- [ ] The window's default ships in the env example and matches the code default

## Notes

Samples are an unversioned snapshot of one preview page, replaced wholesale — unlike a `tg_posts` row, which belongs to a contiguous synced history. They are never promoted into the corpus when a Channel is followed, and nothing is deleted because an Account acted.

No reader is built; nothing calls one until the browsing surface exists.

Seams: channel info fetching, and the probe write path.
