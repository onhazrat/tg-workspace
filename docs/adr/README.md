# Architecture decision records

One file per decision, `ADR-NNN-slug.md`, numbered in the order they were accepted.
A new ADR takes the next number and a row here; `backend/tests/deployment/test_adr_index.py`
fails when a file has no row. An ADR that supersedes part of another says so in its
Status line, and the older one links forward to it.

The locked migration decisions of June 2026 sit outside this series, in
[`docs/migration/DECISIONS.md`](../migration/DECISIONS.md).

| ADR | Topic |
|-----|-------|
| [ADR-001](./ADR-001-repo-layout.md) | Repository layout |
| [ADR-002](./ADR-002-auth.md) | Authentication |
| [ADR-003](./ADR-003-hybrid-sync.md) | ~~Hybrid sync (API-first + cache)~~, ⚠️ superseded by ADR-009 |
| [ADR-004](./ADR-004-job-runner.md) | APScheduler job runner |
| [ADR-005](./ADR-005-vector-search.md) | Vector search |
| [ADR-006](./ADR-006-api-client.md) | API client style |
| [ADR-007](./ADR-007-tor-deployment.md) | Tor deployment |
| [ADR-008](./ADR-008-ai-providers.md) | AI provider abstraction |
| [ADR-009](./ADR-009-server-authoritative-data.md) | Server-authoritative data, superseding ADR-003 and Decisions #4/#5 |
| [ADR-010](./ADR-010-artifact-model.md) | The Artifact model, the four kinds and their frozen Scope; the post-filter half superseded by ADR-026 |
| [ADR-011](./ADR-011-multi-user-registration.md) | Multi-user registration and approval, superseding the registration half of ADR-002 |
| [ADR-012](./ADR-012-egress-seam.md) | The Lane is the egress seam, extending ADR-007 |
| [ADR-013](./ADR-013-open-source-publication.md) | Publishing the repository as open source |
| [ADR-014](./ADR-014-channel-directory.md) | The probe cache becomes the Channel Directory, extending ADR-009 |
| [ADR-015](./ADR-015-directory-statistics.md) | Directory statistics are stored at probe time, not derived on read |
| [ADR-016](./ADR-016-bring-your-own-key.md) | Each Account brings its own AI key |
| [ADR-017](./ADR-017-spend-session.md) | A third View-as tier that spends without seeing |
| [ADR-018](./ADR-018-analysis-window.md) | One global Analysis window with explicit Live and Fixed modes |
| [ADR-019](./ADR-019-channel-reference-graph.md) | The channel reference graph is per-occurrence and permanent |
| [ADR-020](./ADR-020-references-feed-the-directory.md) | References feed the Directory, superseding part of ADR-019 |
| [ADR-021](./ADR-021-post-language.md) | A Post has a Language, read on the server by fastText, superseding ADR-015's `script` |
| [ADR-022](./ADR-022-post-links.md) | A Post keeps its Links as UTF-16 positions over its plain text, beside `links`, with no rescrape |
| [ADR-023](./ADR-023-counters-are-numbers.md) | Channel counters and View counts are stored as numbers; the Post-media storage part superseded by ADR-024 |
| [ADR-024](./ADR-024-view-counts-are-observations.md) | View counts are observations, and Reach is fitted from them, superseding part of ADR-023 |
| [ADR-025](./ADR-025-posts-are-judged-by-estimated-views.md) | Posts are filtered and ordered by their Estimated View count, never by Channel Reach, extending ADR-024; the post-filter half superseded by ADR-026 |
| [ADR-026](./ADR-026-post-filters-leave-the-scope.md) | The post filters leave the Scope; a Post selection replaces them, superseding part of ADR-010 and ADR-025 |
| [ADR-027](./ADR-027-directory-search-index.md) | The Directory is searched with Postgres full-text search, in a companion table |
| [ADR-028](./ADR-028-citation-pairs.md) | Citations are kept as distinct Channel pairs, maintained with the References |
| [ADR-029](./ADR-029-tags-belong-to-the-account.md) | Tags belong to the Account, not the Follow |
| [ADR-030](./ADR-030-generation-is-an-attempt-on-the-worker.md) | Generating a Summary is an Attempt, run on the worker |
| [ADR-031](./ADR-031-tick-all-matching.md) | Tick all is a snapshot up to 10,000 and All matching above it |
| [ADR-032](./ADR-032-one-settings-registry.md) | One Settings registry, addressed by Setting id |
| [ADR-033](./ADR-033-one-time-editor.md) | One time editor for every time filter; its frozen chart superseded by ADR-037 |
| [ADR-034](./ADR-034-one-keyboard-mode.md) | One Keyboard mode, one meaning per key |
| [ADR-035](./ADR-035-every-request-is-recorded.md) | Every Request is recorded, beside the ledger, kept in three tiers |
| [ADR-036](./ADR-036-one-resolved-posts-view.md) | Every Posts read compiles from one resolved Posts view |
| [ADR-037](./ADR-037-one-spread.md) | One Spread for every bound and the Analysis window, and one Number bound editor; the chart half supersedes part of ADR-033 |
| [ADR-038](./ADR-038-prompts-read-covered-posts.md) | An Artifact's prompt reads its Covered Posts, and counts the Missing ones, extending ADR-026 |
| [ADR-039](./ADR-039-posts-view-apart-from-its-edits.md) | The browser keeps one Posts view, apart from its edits, extending ADR-036 |
| [ADR-041](./ADR-041-accounted-work.md) | Accounted work: one context attributes and pays, extending ADR-035 |
