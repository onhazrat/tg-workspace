# #30 ♿ Fix audit Batch 5: accessibility and polish

**State:** merged 2026-07-27 · **Branch:** `fix/audit-batch5-a11y` into `main` · **Diff:** +369 / -93 across 11 files · **Opened:** 2026-07-27

---

♿ Fix audit Batch 5: accessibility and polish

E1 — aria-label on all four header icon buttons. The theme one uses themeTooltip,
which already names the current mode and the next, so the name cannot go stale as
the control cycles. This was confirmed at runtime on staging, not just inferred:
asked to find the command-palette button, an accessibility-tree query returned
"several unnamed buttons (ref_7...ref_10) - their purposes are not specified",
then picked the wrong one.

E2 — the workspace tabs are <Link>s in a <nav aria-label="Workspace sections">
with aria-current="page". setActiveTab already did nothing but navigate to
`?tab=`, so as buttons they lost everything a link gives free: middle-click,
open-in-new-tab, copy link address, an announced destination.

aria-current rather than role="tab" on purpose. The ARIA tab pattern obliges a
roving tabindex and arrow-key navigation; claiming the role without implementing
those leaves assistive-tech users worse off than plain links, because the keys
they are told to press would do nothing.

D5 — the Diagnostics panel heading matches the nav entry that leads there.
D6 — "Analysis Configuration / setup your summary parameters" is now "Summary /
     model and language for the next run". Two selectors is not a configuration
     surface, and the real scope lives on other tabs.
D7 — the per-channel limit renders blank with an "Unlimited" placeholder instead
     of `0`, and the redundant chip beside it is gone. `0` meant "no limit" but
     read as "zero posts", directly contradicting the chip next to it.
C6 — settings column max-w-2xl -> max-w-4xl.

E7 was filed as an incomplete list; the list was accurate
----------------------------------------------------------
The audit says the dialog lists only 6 bindings and is missing tab navigation
(1-8), `/` to focus search, and a sync shortcut. Those shortcuts do not exist:
the app registers exactly two global handlers, cmd+shift+P and `?`. Adding them
to the list would have documented keys that do nothing.

The real defect was different. Four of the six (Enter, cmd+Enter, Esc, Backspace)
are handled inside the command palette and do nothing elsewhere, yet the flat
list presented all six alike. They are now grouped under "Anywhere" and "In the
command palette". Implementing the missing shortcuts is a feature request, not a
bug fix, and is left open.

C11 was one control too many
-----------------------------
Gating the whole filter bar on `generated` - what the audit suggested, and what I
tried first - broke two e2e tests, and the failure was correct. The bar holds two
different kinds of control. Signals is an input to the run: it feeds serverParams
and changing it invalidates a generated report, so hiding it removed the one
control you need before generating. Show / Min hits / Filter by name narrow
candidates that already exist, and before a run those were genuinely inert.
DiscoverFilterBar now takes showResultFilters and only the latter three are gated.

C9 deliberately untouched
--------------------------
The theme control exists in three places, but CommonlyUsedSection is by design "a
curated set of frequently adjusted settings" - duplication is its purpose, so
removing theme from it is a product judgement rather than a defect fix.

Regression coverage
-------------------
a11y-invariants.test.ts asserts every icon-only header button is named, that the
theme button's name tracks its state, that tabs navigate by link rather than
click handler, and that the nav landmark is labelled. It also fails if role="tab"
appears without arrow-key handling, pinning the reasoning above.

That check needed a comment-stripper, because the tab bar's own comment names
role="tab" while explaining why it is not used - the third time in this audit a
sweep has flagged prose quoting the thing it forbids. The stripper has its own
test proving it does not also blind the sweep to real code.

Verified: biome clean, tsc clean, 606 unit tests (was 600), 75/75 e2e.

The e2e scope is now three specs: tg-ui-primitives.spec.ts was pulled in because
the tab change touched its shared gotoSummarizer helper, and it stays in the run.
Four assertions were updated rather than worked around - three locating workspace
tabs by role "button", one asserting the old "System Logs" heading.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
