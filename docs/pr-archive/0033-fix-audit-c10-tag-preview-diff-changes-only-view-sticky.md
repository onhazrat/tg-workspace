# #33 🏷️ Fix audit C10: tag preview diff, changes-only view, sticky header

**State:** merged 2026-07-27 · **Branch:** `fix/audit-c10-tag-preview` into `main` · **Diff:** +309 / -29 across 4 files · **Opened:** 2026-07-27

---

🏷️ Fix audit C10: tag preview diff, changes-only view, sticky header

On an unchanged run the preview rendered every selected channel with "No changes"
in the Action column — ~50 rows of nothing, with the one or two rows that mattered
buried among them, and no way to tell a proposed tag that is new from one the
channel already has.

- Each proposed tag is now coloured by state: green for a tag being added, red and
  struck through for one being removed, dimmed for a no-op.
- Rows are partitioned; only changed rows render by default, behind a
  "Show 47 unchanged channels" toggle.
- The table header is sticky inside a bounded scroll box, so the columns stay
  readable instead of scrolling away immediately.

The highlight and the action are computed the same way. `toApply` upstream
compares case-insensitively, so proposedTagState does too — a highlight that
classified differently from the action would colour rows the run will not touch. A
test pins the two against the same input.

Both halves of the partition stay in `rows`: the counts above the table describe
the whole run, and hiding a row must not change what the run reports.

Tag History (expandable detail, undo) is untouched — a separate feature, not a
defect.

Verification, stated precisely
-------------------------------
biome clean, tsc clean, 624 unit tests (was 612).

e2e could not be brought to green on either arm, so no e2e claim is made here. A
paired comparison from a truncated database, backend restarted, run back-to-back:

    main, C10 stashed    73/75
    main + C10           73/75  (also 74/75, 72/75 across runs)

The same tests fail on both — "discover shows forward-only empty guide" and the two
channel-card hover tests — none of which touch TagView. C10 is therefore
indistinguishable from main and does not regress the suite, but the suite itself is
currently unreliable on this machine for reasons NOT explained by the database
growth recorded in the previous PR: truncating the tg_ tables and restarting the
backend container both failed to restore the 75/75 the same suite produced
repeatedly earlier in the session.

That degradation is unexplained and wants its own investigation before the next
e2e-dependent change is trusted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
