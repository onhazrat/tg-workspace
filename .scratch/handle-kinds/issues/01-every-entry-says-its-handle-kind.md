# HKD-01: Every Directory entry says what its handle is

**What to build:** every probe records the Handle kind Telegram's own page
gives (`channel`, `group`, `bot`, `user`, `free`, `unknown`), from the page
the probe already fetched, at no extra Request. A Channel whose Posts Telegram
withholds is a Hidden Channel: listed like any Channel, shown as "Hidden"
with its subscriber count and a link to its Telegram page, and filtered with
`status:hidden`. A group's members and a bot's monthly users are kept in the
subscriber count and shown with their own unit. The whole of
`.scratch/handle-kinds/spec.md`; decisions in ADR-047; terms in `GLOSSARY.md`.

**Blocked by:** None (can start immediately).

**Status:** done

- [ ] Both soft-block exceptions carry the page HTML; no change to pacing, charging, retries or Request records (a probe of each kind still records exactly one Request).
- [ ] The handle-kind classifier reads the page title's verb (`View`, `Launch`, `Contact`), the header line and the name, per the spec's table; the handle's spelling plays no part, and the presence-line rule is gone. Its docstring says the kind decides what is listed.
- [ ] The probe's no-preview branch stores the classified kind, display name and count with the `unavailable` verdict and empty Samples, instead of an empty payload.
- [ ] `free` is a Handle kind value on the server and in the Directory filter's `kind` values.
- [ ] Stored status `private` is migrated to `hidden`; the verdict, the can't-be-followed status set, the frontend status type, the filter's status values and Discover's candidate handling all say `hidden`.
- [ ] A filter Condition `status:private` finds Hidden Channels; the picker offers only `hidden`; `status:unavailable` still finds both.
- [ ] A group's member count and a bot's monthly users are stored in the subscriber count; a group's online count is not stored.
- [ ] The Directory table and panel show each count with its kind's unit ("members", "monthly users"), no count for users and free handles, and Channels unchanged; the header stays "Subscribers" and sorting is unchanged.
- [ ] A Hidden Channel's verdict reads "Hidden" with a tooltip saying Telegram hides its Posts on the web; its panel shows the subscriber count, a link to its Telegram page and no Samples section.
- [ ] Six real pages are captured into the live-fixture directory with sidecar metadata: a readable Channel, a Hidden Channel, a group, a bot, a user and a free handle.
- [ ] Backend tests at one seam: each fixture is served through Telegram faked at the HTTP transport, the probe runs, and the Directory read API reports status, Handle kind, count and whether the default view lists it. Extra cases: a Channel whose handle ends in "bot" stays a Channel; `status:private` and `status:unavailable` behave as above.
- [ ] Frontend render tests for the table and panel cover the Hidden verdict and tooltip, each unit, the absent counts and the missing Samples section; the filter tests cover `kind:free` and `status:hidden`.
- [ ] Each new guard is mutation-checked with the repo's mutation script, and the commit body carries its `Mutation-checked:` lines.
- [ ] No backfill: entries probed before this change keep `unknown`.

## Comments

- 2026-11-03: implemented on `claude/telegram-feed-preview-iframe-6519ee` and merged into `main` in e51c1a89 (#272).
  Closed in a sweep of stale Status lines; the Status line was never updated at merge.
