# #31 ✨ Fix audit E3 + C7 + C8: affordance, scroll reset, silent scope change

**State:** merged 2026-07-27 · **Branch:** `fix/audit-e3-c7-c8` into `main` · **Diff:** +254 / -2 across 5 files · **Opened:** 2026-07-27

---

✨ Fix audit E3 + C7 + C8: affordance, scroll reset, silent scope change

Three findings confirmed in the staging browser pass but not yet fixed.

E3 — the chip selects had no dropdown affordance
------------------------------------------------
The model and language chips are native <select>s with `appearance: none`, which
strips the platform's own arrow. Measured on staging: `appearance: none`,
`background-image: none`, `padding-right: 0` — provably nothing said they could
be opened, and they rendered identically to the static labels beside them. Each
now carries a chevron, with `pointer-events-none` so the click still falls
through to the select.

C7 — the shared scroll container kept its offset across tabs
-------------------------------------------------------------
Scrolling deep into Posts and switching to Summary landed you partway down a
shorter view, sometimes past its end on an apparently blank screen. Now reset on
`?tab=` change, so it fires however the tab changes: nav links, command palette,
a pasted URL, or opening a history record.

C8 — opening a saved report changed the scope in silence
---------------------------------------------------------
applyHistorySummarySelection calls setSelectedChannels and setDateRange, which is
correct — a report only means anything beside the posts it came from. But nothing
on screen said so, and the "Posts in Scope" counter and every scoped view changed
underneath the user. A dismissible banner now names both things that changed,
with a distinct message for a report saved with no channels, which would
otherwise read "Scope set to 0 channels". The notice reuses formatDateRange and
countOf from earlier batches, so it cannot reintroduce the D4 machine timestamp.

C7 made the e2e suite flaky, and the guard is the fix
------------------------------------------------------
Worth recording, because it nearly shipped. With C7 in, e2e returned 74/75 — then
74/75 again on a different test. That looks exactly like the known contention
flakiness, so it was checked against unmodified main rather than assumed:

  main                      75/75
  + C7 (useEffect)          74/75, twice, different tests
  + C7 (useLayoutEffect)    74/75, a third test
  - C7, with E3 + C8        75/75

The mechanism was not the obvious one. The flaky tests use
`page.goto(...?tab=X)`, so the container is already at 0 and the reset is a
no-op — but writing `scrollTop` unconditionally still forces a layout
read/write on every tab render, and that cascades through the virtualized
channel grid. Comparing first (`if (container.scrollTop !== 0)`) keeps it
genuinely inert in exactly those cases. Two consecutive 75/75 runs after the
guard, and a test pins it so it is not simplified away later.

It is also a useLayoutEffect rather than useEffect, so the new tab paints at the
top instead of rendering at the old offset and jumping afterwards.

Verified: biome clean, tsc clean, 612 unit tests (was 606), 75/75 e2e twice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
