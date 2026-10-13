# DFP-03: Tags belong to the Account

**What to build:** A Tag stops living on the Follow (ADR-029). Unfollowing a tagged Channel keeps
its Tags, and following it again shows them; everything that reads or writes Tags today (the
Channels tab, the bulk Tag route, Tag runs, the Channel filter) behaves exactly as before. This is
the prefactor that lets a Tag sit on an unfollowed Channel in DFP-04. See
`.scratch/directory-follow-picks/spec.md`: user stories 19 to 22, 24 and 25, and the Tags
decisions; read ADR-029 first.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] A per-Account Tag table keyed by the Account, the Channel's normalized handle and the lowercased Tag name, keeping the name as first written, its source (manual or AI) and when it was assigned
- [x] One service is the table's sole writer, declared in the service-kind inventory; the Follow's writer no longer writes Tags
- [x] A migration moves every Follow's Tags, merging case-duplicates and keeping source and time; its test runs the migration's own statement
- [x] The Follow's tags column is dropped, and the superseded-columns guard covers it
- [x] Unfollowing leaves the Tag rows; refollowing shows them on the Channels tab
- [x] The Channels list, the bulk Tag route, Tag runs and the Channel filter keep their wire shapes and behaviour; Tag runs still tag only followed Channels in their Scope
- [x] The tenancy seam classifies the table as user-owned; the account-isolation probes, the export inventory (a Tags section, unfollowed Channels' Tags included) and the import write-scoping inventory list it; an import restores Tags on unfollowed Channels
- [x] `group:` names stay reserved and derived, never stored
- [x] No limit on Tags per Account or Channels per Tag; names keep today's rules (trimmed, case-insensitive, no length cap)
- [x] The `tg_*` cleanup inventory covers the table
