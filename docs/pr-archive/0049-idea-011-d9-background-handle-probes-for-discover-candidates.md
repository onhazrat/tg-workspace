# #49 ✨ IDEA-011 D9: background handle probes for Discover candidates

**State:** merged 2026-07-29 · **Branch:** `discover-handle-probes` into `main` · **Diff:** +2316 / -31 across 25 files · **Opened:** 2026-07-29

---

Resolves what each Discover candidate handle actually *is*, in the background, so the report arrives already triaged instead of asking for judgement on rows that were never actionable.

Most candidates cannot be followed at all — bots, personal accounts, groups and private or deleted channels are referenced from posts exactly the way real channels are.

## Design

**`tg_discover_probes`** stores one row per normalized handle: `status` (`ok` / `unavailable` / `unknown`), a best-effort `kind`, display name, bio, subscriber text. Global, not per-report, so the fetch cost is paid **once per handle ever** rather than once per report — the steady-state cost across reports approaches zero and only the first sweep on a fresh install is expensive.

Joined at read time alongside `isFollowed` / `isIgnored`, so a verdict corrects every saved report at once rather than only the one on screen.

**The sweep** (`services/discover_probe_job.py`) starts automatically when a report opens, at concurrency **2** — deliberately below bulk-follow's 4, because it runs unprompted and competes with sync for the same proxy lanes. Cancellable, capped at 400 handles per sweep, and probes in the report's rank order so the top of the list resolves in seconds rather than after the single-reference tail.

**Two kinds of hiding, kept separate.** A probe is a fact about the handle; a dismissal (D8) is the operator's judgement. Merging them would make an automated verdict indistinguishable from a deliberate one, and let a misprobe pass for something the operator chose. Confirmed-unfollowable rows get their own "Not followable" view. A row carrying both flags appears only under "Ignored" — the deliberate act is the more informative one to preserve, and it keeps the two counts disjoint.

## The rule that makes an indefinite cache safe

A verdict is written **only** when a Telegram page actually parsed (`isTelegramPage`). Timeouts, HTTP errors and proxy block pages record `unknown` with an attempt count and exponential backoff.

Without this, a fetch that failed during an outage would be cached as "not followable" forever, permanently hiding a real channel from every future report with nothing on screen to suggest anything went wrong. An `unknown` costs a retry; a wrong `unavailable` costs a channel, silently. Eight backend tests pin this down specifically.

**Recheck** — per row and in bulk from the "Not followable" view — clears the cached verdict and re-probes, as the second line of defence.

## Type classification is secondary, by design

`channel` / `group` / `bot` / `user` / `unknown`, from `tgme_page_extra`, the action button, and the bot-username suffix rule (Telegram *requires* bot usernames to end in `bot`, so that one is a rule rather than a guess). It words a badge and never decides what gets hidden, because it is heuristics over presentation markup Telegram can restyle. `unknown` is an ordinary outcome.

## A documented reversal

The original D9 in IDEA-011 said explicitly **do not prefetch the whole table**. That advice was right about the cost but wrong about the frequency: it assumed the cost recurred per report, which a global per-handle cache removes. Written up in the idea doc rather than quietly dropped.

## Verification

- Backend **683 passed, 1 skipped** (34 new: 25 probe-service, 9 classifier)
- Frontend **654 pass, 0 fail** (up from 635; 11 new filter tests)
- `tsc -p tsconfig.build.json` clean; mypy clean; `ty` clean on all new files; biome at its 3 pre-existing warnings
- Migration `w5x6y7z8a9b0` applies cleanly on a linear head from `v4w5x6y7z8a9`

## Not verified here

The **proportion** of junk handles in a real corpus was never measured before building — this was scoped on the operator's observation, so the payoff is real but unquantified. The sweep's `resolved` / `unavailable` counters make that ratio visible on the first staging report.

The sweep's live behaviour against real `t.me` responses is also untested locally: the classifier is tested against fixture HTML, not against what Telegram actually serves today. Worth watching the first sweep on staging for handles landing in `unknown` that should have resolved.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
