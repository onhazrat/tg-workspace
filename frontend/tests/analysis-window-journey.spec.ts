import { expect, test } from "./fixtures.ts"

import { seedTestChannel } from "./utils/seed-channel"
import {
  gotoWorkspace,
  pinSelectionToCarrier,
} from "./utils/summarizer-helpers.ts"

/**
 * The Analysis window, end to end, once (AW-09).
 *
 * Deliberately **one** journey. The temporal matrix belongs to
 * `lib/scope/window.test.ts` and `contexts/ScopeContext.test.tsx`, and the
 * frozen-Scope contract to the backend tests; repeating either here buys
 * nothing and costs minutes on every run. What only a browser can answer is
 * whether the pieces meet: that Action shows the window and hands editing to
 * the one editor, that going there does not throw away the Action being
 * written, that what an Artifact records is what the window said at the time,
 * and that inspecting it afterwards changes nothing until somebody asks.
 *
 * A Discover report is the Artifact under test because it is the one of the
 * four a test can create without an AI provider — its aggregation is
 * server-side — and it renders the same `ArtifactScopeLine` as the other three.
 *
 * Nothing here is mocked, which matters more than it looks: `mockDiscoverForwardPosts`
 * stubs report creation with a *canned* frozen Scope, so a journey that used it
 * would assert the fixture's boundaries and pass however wrong the real freeze
 * was. A report with no candidates still carries a Scope, and the Scope is the
 * whole point — so the seeded channel is left empty on purpose.
 *
 * Everything is queried by role, label or test id, never by a styling class.
 */

const DRAFT = "what changed while I was away?"

/** The trigger on Posts and the read-only line on Action share this name. */
const windowControl = "Analysis window"

/**
 * Every field lookup is `exact`. Focusing an elapsed field renders a shortcut
 * row labelled "Shortcuts for Duration", which a substring match happily claims
 * as a second "Duration" — a strict-mode violation that only appears halfway
 * through the run, once something has focus.
 */

test.describe("the Analysis window journey", () => {
  test("Action shows the window, hands off the editing, and freezes what it says", async ({
    page,
  }) => {
    test.setTimeout(180_000)

    const carrierName = `aw09${Date.now()}`
    await gotoWorkspace(page, "channels")
    await seedTestChannel(page, carrierName)
    await pinSelectionToCarrier(page, carrierName)

    // ---- Action: a half-written draft, and the window it would run over ----
    await page.locator("#tour-tab-action").click()
    await expect(page).toHaveURL(/tab=action/)

    const chatDraft = page.getByTestId("action-chat-input")
    await expect(chatDraft).toBeVisible({ timeout: 20_000 })
    await chatDraft.fill(DRAFT)

    const actionWindow = page.getByTestId("action-analysis-window")
    await expect(actionWindow).toBeVisible()

    // ---- Activating it goes to Posts with the one editor already open ----
    await actionWindow.click()
    await expect(page).toHaveURL(/tab=posts/, { timeout: 20_000 })

    const duration = page.getByLabel("Duration", { exact: true })
    await expect(duration).toBeVisible({ timeout: 20_000 })

    // ---- The four fields, and a mode switch that moves none of them ----
    await duration.fill("2h")
    await duration.press("Enter")
    const endGap = page.getByLabel("End gap", { exact: true })
    await endGap.fill("30m")
    await endGap.press("Enter")

    await page.getByRole("button", { name: "Fixed" }).click()
    // A boundary is an instant in either mode, so the platform's own control
    // answers it in both.
    await expect(page.getByLabel("Start", { exact: true })).toHaveAttribute(
      "type",
      "datetime-local",
    )
    await expect(page.getByLabel("Duration", { exact: true })).toHaveValue("2h")
    await page.getByRole("button", { name: "Live" }).click()
    const liveStart = page.getByLabel("Start", { exact: true })
    await expect(liveStart).toHaveAttribute("type", "datetime-local")
    // A Live Start says *when* the window opens, not the `2h 30m` offset the
    // state happens to store. The stamp is matched by shape rather than by
    // value because a Live boundary advances on every tick, and asserting the
    // instant across a mode switch would fail on whichever run crossed a
    // minute. That the switch moves nothing is what Duration answers.
    await expect(liveStart).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    await expect(page.getByLabel("Duration", { exact: true })).toHaveValue("2h")

    // ---- Back to the Action, which is still there ----
    await page.getByTestId("window-editor-return").click()
    await expect(page).toHaveURL(/tab=action/, { timeout: 20_000 })
    await expect(page.getByTestId("action-chat-input")).toHaveValue(DRAFT)

    const liveSummary = (await actionWindow.textContent())?.trim() ?? ""
    expect(liveSummary).toContain("Live ·")
    expect(liveSummary).toContain("(2h)")

    // ---- Creating an Artifact from Action freezes exactly that ----
    await page.getByTestId("action-generate-report").click()
    await expect(page).toHaveURL(/tab=discover/, { timeout: 60_000 })

    const scopeLine = page.getByTestId("artifact-scope-line")
    await expect(scopeLine).toBeVisible({ timeout: 30_000 })
    // Exact boundaries and a derived Duration. Never "ago", never a mode: both
    // describe a window that still moves, and this one has stopped.
    await expect(scopeLine).toContainText("· 2h")
    await expect(scopeLine).not.toContainText("ago")
    await expect(scopeLine).not.toContainText("Live")

    // ---- Looking at it did not touch the workspace ----
    await page.locator("#tour-tab-posts").click()
    const trigger = page.getByRole("button", { name: windowControl })
    await expect(trigger).toBeVisible({ timeout: 20_000 })
    await expect(trigger).toHaveText(liveSummary)

    // ---- Use this Scope does, and what comes back is Fixed ----
    await page.locator("#tour-tab-discover").click()
    await page.getByTestId("use-this-scope").click()

    await page.locator("#tour-tab-posts").click()
    await expect(trigger).toContainText("Fixed ·", { timeout: 20_000 })
    await expect(trigger).toContainText("(2h)")
  })

  /**
   * The editor without a pointer, and the editor without room.
   *
   * Escape and the focus return are the disclosure contract; the bottom sheet
   * is the only presentation a phone gets, because a 26rem anchored popover
   * does not fit one. Both ride on this journey rather than a file of their
   * own, since neither means anything away from the window it edits.
   */
  test("closes on Escape with focus returned, and is a sheet on a phone", async ({
    page,
  }) => {
    test.setTimeout(90_000)

    await gotoWorkspace(page, "posts")
    const trigger = page.getByRole("button", { name: windowControl })
    await expect(trigger).toBeVisible({ timeout: 20_000 })

    await trigger.click()
    await expect(page.getByLabel("Duration", { exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByLabel("Duration", { exact: true })).toBeHidden()
    await expect(trigger).toBeFocused()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    const narrowTrigger = page.getByRole("button", { name: windowControl })
    await expect(narrowTrigger).toBeVisible({ timeout: 20_000 })
    await narrowTrigger.click()

    const sheet = page.getByRole("dialog")
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute("data-slot", "sheet-content")
    await expect(sheet.getByLabel("Duration", { exact: true })).toBeVisible()
  })
})
