/**
 * The View-as ribbon, one tier at a time. Which buttons a tier offers is the
 * security-relevant part: read-only offers elevation and spend, elevated
 * offers only spend, spending offers neither, and every tier can exit.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { ViewAsClaims } from "@/lib/storage/scoped"
import { ribbonTier, ViewAsRibbonBar, writableUntilMs } from "./ViewAsRibbonBar"

afterEach(cleanup)

const claims: ViewAsClaims = {
  subjectUserId: "u-target",
  subjectEmail: "target@example.com",
  actorUserId: "u-owner",
  actorEmail: "owner@example.com",
  mode: "read_only",
  expiresAt: 1_700_000_000,
}

function renderBar(tier: "read" | "elevated" | "spend", widening = false) {
  const calls: string[] = []
  render(
    <ViewAsRibbonBar
      claims={claims}
      tier={tier}
      widening={widening}
      onElevate={(m) => calls.push(`elevate ${m}`)}
      onSpend={(m) => calls.push(`spend ${m}`)}
      onExit={() => calls.push("exit")}
    />,
  )
  const ribbon = screen.getByTestId("view-as-ribbon")
  const labels = screen.getAllByRole("button").map((b) => b.textContent)
  return { calls, ribbon, labels }
}

describe("ribbonTier", () => {
  test("spend wins over elevated, and neither is read-only", () => {
    expect(ribbonTier(true, false)).toBe("spend")
    expect(ribbonTier(true, true)).toBe("spend")
    expect(ribbonTier(false, true)).toBe("elevated")
    expect(ribbonTier(false, false)).toBe("read")
  })
})

describe("writableUntilMs", () => {
  test("only a session that can write has an end the ribbon enforces", () => {
    expect(writableUntilMs(claims, true)).toBe(1_700_000_000_000)
    expect(writableUntilMs(claims, false)).toBeNull()
    expect(writableUntilMs(null, true)).toBeNull()
  })
})

describe("read-only", () => {
  test("says read-only, names both accounts and offers every widening", () => {
    const { ribbon, labels } = renderBar("read")
    expect(ribbon.textContent).toBe(
      "Viewing as target@example.com — read-only. Signed in as owner@example.com.Make a change (5m)10m15mSpend 3mSpend 5mSpend 10mExit",
    )
    expect(ribbon.className).toContain("bg-destructive")
    expect(ribbon.getAttribute("data-view-as-mode")).toBe("read_only")
    expect(labels).toEqual([
      "Make a change (5m)",
      "10m",
      "15m",
      "Spend 3m",
      "Spend 5m",
      "Spend 10m",
      "Exit",
    ])
  })

  test("each button asks for its own tier and minutes", () => {
    const { calls } = renderBar("read")
    fireEvent.click(screen.getByText("10m"))
    fireEvent.click(screen.getByText("Spend 5m"))
    fireEvent.click(screen.getByText("Exit"))
    expect(calls).toEqual(["elevate 10", "spend 5", "exit"])
  })

  test("titles say what a click grants", () => {
    renderBar("read")
    expect(screen.getByText("15m").getAttribute("title")).toBe(
      "Make changes on their behalf for 15 minutes",
    )
    expect(screen.getByText("Spend 3m").getAttribute("title")).toBe(
      "Spend their AI key, bots and Telegram budget for 3 minutes",
    )
  })

  test("widening disables every widening button but not Exit", () => {
    renderBar("read", true)
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(
        button.textContent !== "Exit",
      )
    }
  })
})

describe("elevated", () => {
  test("says changes are saved to their account and offers only spend", () => {
    const { ribbon, labels } = renderBar("elevated")
    expect(ribbon.textContent).toBe(
      "Acting as target@example.com — changes are saved to their account and recorded as yours. Signed in as owner@example.com.Spend 3mSpend 5mSpend 10mExit",
    )
    expect(ribbon.className).toContain("bg-amber-600")
    expect(labels).toEqual(["Spend 3m", "Spend 5m", "Spend 10m", "Exit"])
  })
})

describe("spending", () => {
  test("says whose money pays and offers nothing but Exit", () => {
    const { ribbon, labels } = renderBar("spend")
    expect(ribbon.textContent).toBe(
      "Spending as target@example.com — their AI key, bots and Telegram budget pay for what you do, and every call is recorded as yours. Signed in as owner@example.com.Exit",
    )
    expect(ribbon.className).toContain("bg-rose-700")
    expect(labels).toEqual(["Exit"])
  })
})
