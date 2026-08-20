import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Source-level guards for the two header defects the staging pass confirmed.
 *
 * **E1** — the four header icon buttons had tooltips but no accessible name. A
 * tooltip is not a name: asked to find the command-palette button, an
 * accessibility-tree query returned *"several unnamed buttons (ref_7…ref_10) —
 * their purposes are not specified"*, then guessed the wrong one. That is what a
 * screen-reader user gets.
 *
 * **E2** — the workspace tabs were `<button onClick={() => setActiveTab(…)}>`,
 * even though `setActiveTab` did nothing but navigate to `?tab=`. As buttons
 * they lost everything a link gives free: middle-click, open-in-new-tab, copy
 * link address, and an announced destination.
 */

const APP = join(import.meta.dir, "..", "App.tsx")

/** The icon-only controls in the header, by the icon each renders. */
const HEADER_ICON_BUTTONS = [
  "CommandIcon",
  "HelpCircle",
  "Keyboard",
  "fullscreenIcon",
  "themeIcon",
]

/**
 * Comments legitimately name the thing they forbid — the tab bar carries a note
 * explaining why it uses `aria-current` *rather than* `role="tab"`, which would
 * otherwise trip the check below. Only code counts.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

describe("header accessibility", () => {
  const source = readFileSync(APP, "utf8")
  const code = stripComments(source)

  it("names every icon-only header button", () => {
    // One `aria-label` per icon-only button. Without a text child there is
    // nothing else for an accessible name to come from.
    const labels = source.match(/aria-label=/g) ?? []
    expect(labels.length).toBeGreaterThanOrEqual(HEADER_ICON_BUTTONS.length)
  })

  /**
   * Focus mode hides the header, including the button that turned it on.
   *
   * So the fullscreen control is the one header button that must exist in two
   * places: the header, and the tab bar while focus mode is active. Ship only
   * the first and the page becomes chromeless with no visible way out — Esc and
   * F11 work, but nothing on screen says so. The count check above cannot catch
   * this, because the header button alone satisfies it.
   */
  it("offers a way out of focus mode once the header is hidden", () => {
    expect(code).toContain('data-testid="fullscreen-button"')
    expect(code).toContain('data-testid="fullscreen-exit-button"')
    // Rendered under `isFullscreen`, i.e. exactly when the header is not.
    expect(code).toContain("{isFullscreen && (")
  })

  /**
   * Both fullscreen controls name themselves from the same state-derived label,
   * for the reason the theme button does: a fixed "Full screen" would lie the
   * moment you are already in it.
   */
  it("keeps the fullscreen buttons' names in step with their state", () => {
    const labels = source.match(/aria-label=\{fullscreenLabel\}/g) ?? []
    expect(labels.length).toBe(2)
  })

  it("keeps the theme button's name in step with its state", () => {
    // The theme control cycles system -> light -> dark, so a fixed label would
    // go stale. It reuses the tooltip text, which already names both the current
    // mode and the next one.
    expect(source).toContain("aria-label={themeTooltip}")
  })

  it("navigates tabs with links, not click handlers", () => {
    expect(source).not.toContain("onClick={() => setActiveTab(tab.id")
    expect(source).toContain('to="/summarizer"')
    expect(source).toContain('aria-current={isActive ? "page" : undefined}')
  })

  it("groups the tab links in a named nav landmark", () => {
    expect(source).toContain('<nav aria-label="Workspace sections"')
  })

  /**
   * `role="tab"` obliges a roving tabindex and arrow-key navigation. Claiming it
   * without implementing those is worse than plain links, because the keys
   * assistive tech tells the user to press would do nothing. If someone adds the
   * role later, this fails and points at the obligation that comes with it.
   */
  it("does not claim the ARIA tab pattern without implementing it", () => {
    const claimsTabRole =
      code.includes('role="tab"') || code.includes('role="tablist"')
    const implementsRovingFocus =
      code.includes("ArrowRight") || code.includes("ArrowLeft")
    if (claimsTabRole) {
      expect(implementsRovingFocus).toBe(true)
    }
    // Today it claims neither, which is the state this asserts is coherent.
    expect(claimsTabRole).toBe(false)
  })

  /**
   * C7 resets the shared workspace scroll container on every `?tab=` change.
   *
   * The guard is not a micro-optimisation. Writing `scrollTop` unconditionally
   * forces a layout read/write on every tab render, and that alone cascaded
   * through the virtualized channel grid badly enough to make the e2e suite
   * flaky — three runs failed on three *different* tests while the same suite
   * was green on `main`, including on tabs that were never scrolled, where the
   * write was already a no-op. Comparing first keeps it genuinely inert.
   */
  it("resets tab scroll without forcing a layout write every render", () => {
    expect(code).toContain("container.scrollTop !== 0")
    // A layout effect, so the new tab paints at the top instead of jumping
    // after paint.
    expect(code).toContain("useLayoutEffect")
  })

  it("strips comments without stripping code", () => {
    // Guards the guard: this check exists because the tab bar's own comment
    // names `role="tab"` while explaining why it is not used.
    expect(stripComments('/* role="tab" is wrong here */')).not.toContain(
      'role="tab"',
    )
    expect(stripComments('  // role="tablist" too')).not.toContain("tablist")
    expect(stripComments('<nav aria-label="Workspace sections"')).toContain(
      "aria-label",
    )
  })
})
