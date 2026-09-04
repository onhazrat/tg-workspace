# #37 🎨 Fix audit E5: make the guided tour follow the app theme

**State:** merged 2026-07-27 · **Branch:** `fix/audit-e5-tour-and-dark-default` into `main` · **Diff:** +155 / -0 across 2 files · **Opened:** 2026-07-27

---

🎨 Fix audit E5: make the guided tour follow the app theme

useGuidedTour imports driver.js/dist/driver.css, which ships a fixed light
palette, so the tour rendered a white card with black text on top of the dark app
— the popover looked like it belonged to a different product.

The overrides are driven by the same custom properties as the rest of the app
(--card-bg, --ink, --line-color) rather than a hard-coded second dark theme, so the
tour follows whichever palette is active — including the third one defined in
index.css — and cannot drift from the app.

Verified in a real browser on the local dev server, both directions:

    theme   --card-bg   popover bg         text               arrow
    dark    #1a1a1a     rgb(26,26,26)      rgb(228,227,224)   rgb(26,26,26)
    light   #ffffff     rgb(255,255,255)   rgb(20,20,20)      rgb(255,255,255)

The arrow needs its own rules: it is a CSS triangle coloured through
border-*-color, so all four sides need the popover background or a white spike is
left pointing at the highlighted element.

Not fixed: the audit's positioning complaints. Steps already declare explicit
side/align, and C4's tag-wall collapse (489px -> 92px) removed most of what step 1's
popover was overlapping. Re-measuring needs a tour run on a deployed build.

Decisions recorded in the same doc
-----------------------------------
C9 — closed as working-as-intended. All three theme controls stay;
CommonlyUsedSection is explicitly "a curated set of frequently adjusted settings",
so duplicating one there is its purpose. The related ask, that first-time visitors
get dark, is already true and was verified rather than assumed: main.tsx passes
defaultTheme="dark", theme is deliberately absent from the settings schema, and
theme-provider writes to localStorage only on an explicit setTheme, never on
mount. Confirmed live — no stored preference resolves to dark with class="dark".

E4 touch fallback — closed, not deferred. The app is desktop-only, so the seven
hover-revealed controls stay as they are; the keyboard half was already fixed.

Mobile/responsive, the light theme beyond the checks above, and the six unreviewed
Settings sections stay unverified by decision. resize_window reports success while
window.innerWidth never changes, so no narrow viewport was reachable.

A flaky test, partially diagnosed and left open
------------------------------------------------
tg-ui-primitives.spec.ts:63 fails intermittently — passes in isolation, fails about
half the time in the file, at 0, 6, 148 and 154 channels alike, so the warm-database
rule from the previous PR does not explain it. The locator is
getByRole("button", { name: /Sync All/i }) and that label is
`<span className="hidden sm:inline">Sync All</span>`, so it has no accessible name
until the toolbar renders, which waits on the channels query; setTheme reloads and
discards that data, and the next assertion allows only 5s.

An attempted fix — waiting for [data-channel-name] inside setTheme — did not work
and was reverted: two of three runs still failed and the 15s wait simply timed out,
doubling the run. The card is genuinely absent after that reload for a reason not
yet identified. Left open rather than papered over.

Verified: biome clean, tsc clean, 625 unit tests. CSS-only change, scoped to
.driver-popover* classes that appear nowhere else; no e2e covers the tour popover.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
